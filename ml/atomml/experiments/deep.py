"""Train DKT and SAKT on the GPU and save their test predictions for the kt report.

Training students only; early stopping on validation AUC; one prediction per
test attempt, aligned with the other models' predictions.
"""

from __future__ import annotations

import logging
import time

import numpy as np
import torch
from torch import nn

from atomml.experiments.common import arrays, data, save_pred
from atomml.kt.deep import DKT, SAKT, session_counts
from atomml.metrics import weighted_auc

log = logging.getLogger(__name__)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DKT_WINDOW, SAKT_WINDOW = 256, 200


def _prepared():
    A = arrays()
    n_inb, c_inb = session_counts(A["group"], A["correct"])
    new_user = np.r_[True, A["user"][1:] != A["user"][:-1]]
    new_bucket = np.r_[True, A["bucket"][1:] != A["bucket"][:-1]]
    # bucket ordinal within the student, and log days since their previous bucket
    user_first_bucket = np.maximum.accumulate(np.where(new_user, A["bucket"], 0))
    step = A["bucket"] - user_first_bucket
    b_days = A["days"][new_bucket]
    b_user = A["user"][new_bucket]
    b_gap = np.r_[0.0, np.diff(b_days)]
    b_gap[np.r_[True, b_user[1:] != b_user[:-1]]] = 0.0
    return A, n_inb, c_inb, step, np.log1p(np.maximum(b_gap, 0)).astype(np.float32)


# ── DKT ──────────────────────────────────────────────────────────────────────


def dkt_windows(A, step, part):
    """(attempt start, attempt end, first bucket) of each window of `part` students."""
    rows = np.flatnonzero(A[part])
    win = A["user"][rows] * 100_000 + step[rows] // DKT_WINDOW
    starts = np.r_[0, np.flatnonzero(win[1:] != win[:-1]) + 1]
    ends = np.r_[starts[1:], len(rows)]
    return rows, starts, ends


def dkt_batch(A, n_inb, c_inb, step, b_gap, rows, starts, ends, ids):
    att = np.concatenate([rows[starts[i] : ends[i]] for i in ids])
    att_win = np.repeat(np.arange(len(ids)), ends[ids] - starts[ids])
    first_step = step[rows[starts[ids]]] // DKT_WINDOW * DKT_WINDOW
    att_step = step[att] - first_step[att_win]
    n_steps = int(att_step.max()) + 1
    gap = np.zeros((len(ids), n_steps), np.float32)
    gap[att_win, att_step] = b_gap[A["bucket"][att]]
    t = lambda x, dt=torch.long: torch.as_tensor(x, dtype=dt, device=DEVICE)  # noqa: E731
    return att, (len(ids), n_steps, t(att_win), t(att_step), t(A["item"][att]), t(A["correct"][att]),
                 t(gap, torch.float32), t(n_inb[att], torch.float32), t(c_inb[att], torch.float32))  # fmt: skip


# ── SAKT ─────────────────────────────────────────────────────────────────────


def sakt_windows(A, part, stride):
    """Windows of up to SAKT_WINDOW attempts per student; each attempt is
    predicted in exactly one window, with as much history as fits."""
    rows = np.flatnonzero(A[part])
    u = A["user"][rows]
    bounds = np.r_[0, np.flatnonzero(u[1:] != u[:-1]) + 1, len(rows)]
    wins = []  # (start, end, predict_from) in positions of `rows`
    for s, e in zip(bounds[:-1], bounds[1:], strict=True):
        w = s
        while True:
            end = min(w + SAKT_WINDOW, e)
            wins.append((w, end, s if w == s else w + SAKT_WINDOW - stride))
            if end == e:
                break
            w += stride
    return rows, np.array(wins)


def sakt_batch(A, n_inb, c_inb, rows, wins, ids):
    length = int((wins[ids, 1] - wins[ids, 0]).max())
    shape = (len(ids), length)
    item, corr, bucket = (
        np.zeros(shape, np.int64),
        np.zeros(shape, np.int64),
        np.full(shape, -1, np.int64),
    )
    valid, target = np.zeros(shape, bool), np.zeros(shape, bool)
    ni, ci = np.zeros(shape, np.float32), np.zeros(shape, np.float32)
    att = np.full(shape, -1, np.int64)
    for r, i in enumerate(ids):
        s, e, p = wins[i]
        idx = rows[s:e]
        n = e - s
        item[r, :n], corr[r, :n], bucket[r, :n] = (
            A["item"][idx],
            A["correct"][idx],
            A["bucket"][idx],
        )
        ni[r, :n], ci[r, :n] = n_inb[idx], c_inb[idx]
        valid[r, :n] = True
        target[r, p - s : n] = True
        att[r, :n] = idx
    t = lambda x, dt=torch.long: torch.as_tensor(x, dtype=dt, device=DEVICE)  # noqa: E731
    return (
        att,
        target,
        (
            t(item),
            t(corr),
            t(bucket),
            t(valid, torch.bool),
            t(ni, torch.float32),
            t(ci, torch.float32),
        ),
    )


# ── training ────────────────────────────────────────────────────────────────


def _fit(model, make_train_batches, predict, valid_y, epochs, lr=1e-3):
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    best, best_state, bad = -1.0, None, 0
    for epoch in range(epochs):
        model.train()
        t0, total = time.perf_counter(), 0.0
        for logits_fn, y, w in make_train_batches():
            opt.zero_grad(set_to_none=True)
            with torch.autocast(DEVICE, dtype=torch.float16, enabled=DEVICE == "cuda"):
                logits = logits_fn(model)
            loss = (loss_fn(logits.float(), y) * w).sum() / w.sum()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            total += float(loss)
        auc = weighted_auc(valid_y, predict(model, "valid"))
        log.info("%s epoch %d: train loss %.4f, valid AUC %.4f (%.0fs)", type(model).__name__, epoch + 1,
                 total, auc, time.perf_counter() - t0)  # fmt: skip
        if auc > best:
            best, bad = auc, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= 2:
                break
    model.load_state_dict(best_state)
    return best


def run_dkt(A, n_inb, c_inb, step, b_gap, epochs=8, batch=48):
    torch.manual_seed(0)
    model = DKT(data().n_items).to(DEVICE)
    split = {p: dkt_windows(A, step, p) for p in ("train", "valid", "test")}

    def batches():
        rows, starts, ends = split["train"]
        order = np.random.default_rng(len(starts)).permutation(len(starts))
        for s in range(0, len(order), batch):
            att, args = dkt_batch(
                A, n_inb, c_inb, step, b_gap, rows, starts, ends, order[s : s + batch]
            )
            y = torch.as_tensor(A["correct"][att], dtype=torch.float32, device=DEVICE)
            yield (lambda m, a=args: m(*a)), y, torch.ones_like(y)

    @torch.no_grad()
    def predict(model, part):
        model.eval()
        rows, starts, ends = split[part]
        out = np.empty(len(rows), np.float32)
        index = np.empty(A["user"].shape[0], np.int64)
        index[rows] = np.arange(len(rows))
        for s in range(0, len(starts), batch * 2):
            ids = np.arange(s, min(s + batch * 2, len(starts)))
            att, args = dkt_batch(A, n_inb, c_inb, step, b_gap, rows, starts, ends, ids)
            with torch.autocast(DEVICE, dtype=torch.float16, enabled=DEVICE == "cuda"):
                out[index[att]] = torch.sigmoid(model(*args).float()).cpu().numpy()
        return out

    best = _fit(model, batches, predict, A["correct"][A["valid"]], epochs)
    return predict(model, "test"), best


def run_sakt(A, n_inb, c_inb, epochs=8, batch=96):
    torch.manual_seed(0)
    model = SAKT(data().n_items, window=SAKT_WINDOW).to(DEVICE)
    train = sakt_windows(A, "train", SAKT_WINDOW)
    split = {p: sakt_windows(A, p, SAKT_WINDOW // 2) for p in ("valid", "test")}

    def batches():
        rows, wins = train
        order = np.random.default_rng(len(wins)).permutation(len(wins))
        for s in range(0, len(order), batch):
            att, target, args = sakt_batch(A, n_inb, c_inb, rows, wins, order[s : s + batch])
            y = torch.as_tensor(
                np.where(att >= 0, A["correct"][np.maximum(att, 0)], 0),
                dtype=torch.float32,
                device=DEVICE,
            )
            w = torch.as_tensor(target, dtype=torch.float32, device=DEVICE)
            yield (lambda m, a=args: m(*a)), y, w

    @torch.no_grad()
    def predict(model, part):
        model.eval()
        rows, wins = split[part]
        index = np.empty(A["user"].shape[0], np.int64)
        index[rows] = np.arange(len(rows))
        out = np.empty(len(rows), np.float32)
        for s in range(0, len(wins), batch * 2):
            ids = np.arange(s, min(s + batch * 2, len(wins)))
            att, target, args = sakt_batch(A, n_inb, c_inb, rows, wins, ids)
            with torch.autocast(DEVICE, dtype=torch.float16, enabled=DEVICE == "cuda"):
                p = torch.sigmoid(model(*args).float()).cpu().numpy()
            out[index[att[target]]] = p[target]
        return out

    best = _fit(model, batches, predict, A["correct"][A["valid"]], epochs)
    return predict(model, "test"), best


def run() -> str:
    A, n_inb, c_inb, step, b_gap = _prepared()
    lines = []
    for name, fn in (
        ("dkt", lambda: run_dkt(A, n_inb, c_inb, step, b_gap)),
        ("sakt", lambda: run_sakt(A, n_inb, c_inb)),
    ):
        t0 = time.perf_counter()
        pred, best = fn()
        save_pred(name, pred)
        lines.append(f"{name}: best validation AUC {best:.4f}, {time.perf_counter() - t0:.0f}s")
        log.info(lines[-1])
    return "\n".join(lines) + "\nPredictions saved; `uv run atomml kt` includes them in the report."
