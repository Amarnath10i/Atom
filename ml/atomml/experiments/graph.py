"""Does a topic graph carry signal? Atom's "molecular memory graph", tested.

Atom links topics ("bonds") two ways: an embedding of each topic's text with
an edge wherever cosine similarity >= 0.45, and links an LLM proposes. The
graph is then used to pass evidence between topics. The question here is
simply whether a student's earlier results on an exercise's neighbours
predict how they do on it, beyond their own history with it.

Base: LightGBM on the transferable features without any topic evidence.
Then, one at a time, the student's earlier attempts and accuracy on the
exercise's neighbours under:

* tree: Junyi's curated topic tree (exercises sharing a level-4 group)
* atom-bonds: Atom's own rule, cosine >= 0.45 between 384-d multilingual
  sentence embeddings of the exercise names (paraphrase-multilingual-MiniLM)
* random: as many random neighbours per exercise as atom-bonds has (control)
* learned: for each exercise, the 10 exercises whose earlier accuracy best
  predicts it among training students (correlation of per-student accuracy)

Each graph's gain is a paired AUC difference against the base on the same
test attempts, with a student-level bootstrap.
"""

from __future__ import annotations

import logging

import lightgbm as lgb
import numpy as np
import pandas as pd
import scipy.sparse as sp

from atomml.config import settings
from atomml.experiments.common import arrays, data, features, write_report
from atomml.experiments.kt import LGB_PARAMS, POPULATION
from atomml.kt.features import Graph, neighbour_counts
from atomml.metrics import paired_auc_difference, score

log = logging.getLogger(__name__)
TOPIC = ["n_topic", "acc_topic"]
BOND_MIN_SIM = 0.45  # agents/nucleus.py


def _csr(rows, cols, n) -> sp.csr_matrix:
    keep = rows != cols
    return sp.csr_matrix((np.ones(keep.sum()), (rows[keep], cols[keep])), shape=(n, n))


def tree_graph() -> Graph:
    lv4 = data().items["level4"].to_numpy()
    r, c = np.nonzero(lv4[:, None] == lv4[None, :])
    return Graph("tree", _csr(r, c, len(lv4)))


def embedding_graph() -> tuple[Graph, np.ndarray]:
    path = settings.paths.cache / "item_name_embeddings.npy"
    if path.exists():
        emb = np.load(path)
    else:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
        emb = model.encode(data().items["name"].tolist(), normalize_embeddings=True, batch_size=64)
        np.save(path, emb)
    sim = emb @ emb.T
    r, c = np.nonzero(sim >= BOND_MIN_SIM)
    return Graph("atom_bonds", _csr(r, c, len(emb))), sim


def random_graph(like: Graph, seed: int = 0) -> Graph:
    rng = np.random.default_rng(seed)
    n = like.adj.shape[0]
    deg = np.diff(like.adj.indptr)
    rows = np.repeat(np.arange(n), deg)
    cols = np.concatenate([rng.choice(n - 1, d, replace=False) for d in deg])
    cols = cols + (cols >= rows)  # skip self
    return Graph("random", _csr(rows, cols, n))


def learned_graph(k: int = 10, min_common: int = 30) -> Graph:
    """Top-k exercises by correlation of per-student accuracy, training students only."""
    A = arrays()
    tr = A["train"]
    n_items = data().n_items
    acc = (
        pd.DataFrame({"u": A["user"][tr], "i": A["item"][tr], "y": A["correct"][tr]})
        .groupby(["u", "i"])["y"]
        .mean()
    )
    u_codes, u = np.unique(acc.index.get_level_values(0), return_inverse=True)
    m = sp.csr_matrix(
        (acc.to_numpy() + 1e-3, (u, acc.index.get_level_values(1))), shape=(len(u_codes), n_items)
    )
    present = (m > 0).astype(np.float64)
    centered = m.copy()
    means = np.asarray(m.sum(0)).ravel() / np.maximum(np.asarray(present.sum(0)).ravel(), 1)
    centered.data -= means[centered.indices]
    common = (present.T @ present).toarray()
    cov = (centered.T @ centered).toarray()
    var = np.asarray(centered.multiply(centered).sum(0)).ravel()
    corr = cov / np.sqrt(np.outer(var, var) + 1e-12)
    corr[common < min_common] = -np.inf
    np.fill_diagonal(corr, -np.inf)
    cols = np.argsort(-corr, axis=1)[:, :k]
    rows = np.repeat(np.arange(n_items), k)
    ok = np.isfinite(corr[rows, cols.ravel()])
    return Graph("learned", _csr(rows[ok], cols.ravel()[ok], n_items))


def _fit_predict(x: np.ndarray, cols: list[str]) -> np.ndarray:
    A = arrays()
    tr, va, te, y = A["train"], A["valid"], A["test"], A["correct"]
    va_idx = np.random.default_rng(1).choice(np.flatnonzero(va), 1_000_000, replace=False)
    dtrain = lgb.Dataset(x[tr], y[tr], feature_name=cols)
    booster = lgb.train(LGB_PARAMS, dtrain, 2000, valid_sets=[dtrain.create_valid(x[va_idx], y[va_idx])],
                        callbacks=[lgb.early_stopping(50, verbose=False)])  # fmt: skip
    return booster.predict(x[te], num_iteration=booster.best_iteration)


def run() -> str:
    A = arrays()
    te = A["test"]
    y, users = A["correct"][te], A["user"][te]
    base_f = features("strict")
    base_cols = [c for c in base_f.columns if c not in POPULATION + TOPIC]
    x_base = base_f[base_cols].to_numpy(np.float32)
    p_base = _fit_predict(x_base, base_cols)

    bonds, sim = embedding_graph()
    graphs = [tree_graph(), bonds, random_graph(bonds), learned_graph()]
    rows = [{"evidence added": "none (base)", "links per exercise": "-", "AUC": f"{score(y, p_base, users, n_boot=1).auc[0]:.4f}",
             "gain over base": "-"}]  # fmt: skip
    for g in graphs:
        n_nb, c_nb = neighbour_counts(data().attempts, g, naive=False)
        extra = np.column_stack([np.log1p(n_nb), (c_nb + 1.4) / (n_nb + 2.0)]).astype(np.float32)
        p = _fit_predict(
            np.hstack([x_base, extra]), base_cols + [f"n_nb_{g.name}", f"acc_nb_{g.name}"]
        )
        d = paired_auc_difference(y, p_base, p, users)
        deg = np.diff(g.adj.indptr)
        rows.append({"evidence added": g.name, "links per exercise": f"{deg.mean():.1f} (median {np.median(deg):.0f})",
                     "AUC": f"{score(y, p, users, n_boot=1).auc[0]:.4f}",
                     "gain over base": f"{d[0]:+.4f} ({d[1]:+.4f} to {d[2]:+.4f})"})  # fmt: skip
        log.info("%s: %+.4f", g.name, d[0])

    # how much do Atom-style bonds agree with the curated tree?
    tree = graphs[0].adj
    overlap = bonds.adj.multiply(tree).sum() / max(bonds.adj.sum(), 1)
    sims = sim[np.triu_indices_from(sim, 1)]
    text = "\n".join(
        [
            "# Does the topic graph carry signal? (Junyi Academy, test students)",
            "",
            "LightGBM on each student's own history with the exercise, then the same model with the "
            "student's earlier attempts and accuracy on the exercise's linked exercises added, one graph at a "
            "time. Gains are paired AUC differences on the same test attempts (bootstrap over students).",
            "",
            pd.DataFrame(rows).to_markdown(index=False),
            "",
            f"Atom's bond rule (cosine >= {BOND_MIN_SIM}) links {bonds.adj.nnz:,} exercise pairs; "
            f"{overlap:.1%} of them fall inside a curated topic group. Name embeddings: median pairwise cosine "
            f"{np.median(sims):.2f}, 90th percentile {np.quantile(sims, 0.9):.2f}.",
            "",
        ]
    )  # fmt: skip
    write_report("graph", text)
    return text
