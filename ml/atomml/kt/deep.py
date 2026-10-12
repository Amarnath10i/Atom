"""Deep knowledge tracing models, under the same visibility rule as the rest.

* DKT (Piech et al. 2015) reads a student's history as a sequence. Here one
  LSTM step is one 15-minute bucket: the bucket's (exercise, right/wrong)
  interactions are summed into its input. Attempts in bucket B are predicted
  from the state after bucket B-1, the target exercise and the running counts
  on that exercise earlier in the session, so no other exercise of bucket B
  is ever visible.
* SAKT (Pandey & Karypis 2019) attends from the target exercise to past
  interactions. The attention mask is the visibility rule itself: attempt t
  may attend to attempt j only if j is in an earlier bucket, or is an earlier
  attempt on the same exercise in t's bucket. A learned "nothing yet" key is
  always visible, so a student's first attempt still has something to attend to.

Long histories are cut into windows (DKT: 256 buckets; SAKT: 200 attempts with
the second half of overlapping windows predicted), identically in training and
evaluation.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn


def session_counts(group: np.ndarray, correct: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Attempts and corrects earlier in the same (student, bucket, exercise) group."""
    start = np.r_[True, group[1:] != group[:-1]]
    idx = np.arange(len(group))
    first = np.maximum.accumulate(np.where(start, idx, 0))
    n = idx - first
    cum = np.cumsum(correct) - correct
    return n.astype(np.float32), (cum - cum[first]).astype(np.float32)


def _session_feats(n_inb: torch.Tensor, c_inb: torch.Tensor) -> torch.Tensor:
    return torch.stack([torch.log1p(n_inb), (c_inb + 1.4) / (n_inb + 2.0)], dim=-1)


class DKT(nn.Module):
    def __init__(self, n_items: int, d: int = 128, dropout: float = 0.2):
        super().__init__()
        self.inter = nn.Embedding(2 * n_items, d)
        self.gap = nn.Linear(1, d)
        self.lstm = nn.LSTM(d, d, batch_first=True)
        self.query = nn.Embedding(n_items, d)
        self.h0 = nn.Parameter(torch.zeros(d))
        self.out = nn.Sequential(
            nn.Linear(3 * d + 2, d), nn.ReLU(), nn.Dropout(dropout), nn.Linear(d, 1)
        )

    def forward(self, n_win, n_steps, att_win, att_step, item, correct, gap, n_inb, c_inb):
        """Attempts (flattened over the batch) carry their window and bucket step.
        gap: (n_win, n_steps) log days since the previous bucket."""
        d = self.h0.shape[0]
        x = torch.zeros(n_win, n_steps, d, device=item.device)
        x.index_put_((att_win, att_step), self.inter(item * 2 + correct), accumulate=True)
        x = x + self.gap(gap.unsqueeze(-1))
        h, _ = self.lstm(x)
        h_prev = torch.cat([self.h0.expand(n_win, 1, d), h[:, :-1]], dim=1)[att_win, att_step]
        q = self.query(item)
        z = torch.cat([h_prev, q, h_prev * q, _session_feats(n_inb, c_inb)], dim=-1)
        return self.out(z).squeeze(-1)


class SAKT(nn.Module):
    def __init__(
        self, n_items: int, d: int = 64, heads: int = 4, window: int = 200, dropout: float = 0.2
    ):
        super().__init__()
        self.inter = nn.Embedding(2 * n_items, d)
        self.null = nn.Parameter(torch.zeros(1, 1, d))
        self.query = nn.Embedding(n_items, d)
        self.pos = nn.Embedding(window + 1, d)
        self.attn = nn.MultiheadAttention(d, heads, dropout=dropout, batch_first=True)
        self.norm1, self.norm2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.ffn = nn.Sequential(
            nn.Linear(d, 2 * d), nn.ReLU(), nn.Dropout(dropout), nn.Linear(2 * d, d)
        )
        self.out = nn.Linear(d + 2, 1)
        self.heads = heads

    def forward(self, item, correct, bucket, valid, n_inb, c_inb):
        """(B, L) tensors; `valid` marks real attempts (windows are right-padded)."""
        b, length = item.shape
        pos = torch.arange(length, device=item.device)
        keys = self.inter(item * 2 + correct) + self.pos(pos + 1)
        keys = torch.cat([self.null.expand(b, 1, -1), keys], dim=1)
        q = self.query(item) + self.pos(pos + 1)
        earlier_bucket = bucket.unsqueeze(2) > bucket.unsqueeze(1)  # [t, j]: j in an earlier bucket
        same_session = (
            (bucket.unsqueeze(2) == bucket.unsqueeze(1))
            & (item.unsqueeze(2) == item.unsqueeze(1))
            & (pos.unsqueeze(1) > pos.unsqueeze(0))
        )
        visible = (earlier_bucket | same_session) & valid.unsqueeze(1)
        visible = torch.cat(
            [torch.ones(b, length, 1, dtype=torch.bool, device=item.device), visible], dim=2
        )
        mask = ~visible.repeat_interleave(self.heads, dim=0)
        a, _ = self.attn(q, keys, keys, attn_mask=mask, need_weights=False)
        h = self.norm1(q + a)
        h = self.norm2(h + self.ffn(h))
        return self.out(torch.cat([h, _session_feats(n_inb, c_inb)], dim=-1)).squeeze(-1)
