"""Does a topic graph carry signal? Atom's "molecular memory graph", tested.

Atom links topics ("bonds") two ways: an embedding of each topic's text with
an edge wherever cosine similarity >= 0.45, and links an LLM proposes. The
graph is then used to pass evidence between topics. The question here is
simply whether a student's earlier results on an exercise's neighbours
predict how they do on it, beyond their own history with it.

Base: LightGBM on the transferable features without any topic evidence.
Then, one at a time, the student's earlier attempts and accuracy on the
exercise's neighbours under four graphs of equal density (the curated
tree's, about 8 links per exercise), so no graph wins by seeing more:

* tree: Junyi's curated topic tree (exercises sharing a level-4 group)
* embedding_knn: Atom's semantic bonds made usable, each exercise linked to
  the names most similar by 384-d multilingual sentence embeddings
  (paraphrase-multilingual-MiniLM)
* random: random links (control)
* learned: the exercises whose earlier accuracy best predicts this one among
  training students (correlation of per-student accuracy)

Atom's literal rule (cosine >= 0.45) is reported, not expanded: on these
names it links 70% of all pairs, i.e. nearly the student's whole history.

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


def knn_graph(sim: np.ndarray, k: int) -> Graph:
    """Each exercise linked to its k most similar names: Atom's semantic bonds
    at the density of the curated tree (the 0.45 threshold links 70% of pairs)."""
    s = sim.copy()
    np.fill_diagonal(s, -np.inf)
    cols = np.argsort(-s, axis=1)[:, :k]
    return Graph("embedding_knn", _csr(np.repeat(np.arange(len(s)), k), cols.ravel(), len(s)))


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
    tree = tree_graph()
    k = int(round(np.diff(tree.adj.indptr).mean()))  # every graph tested at the tree's density
    graphs = [tree, knn_graph(sim, k), random_graph(tree), learned_graph(k)]
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

    # how dense is Atom's own rule, and how much of it agrees with the curated tree?
    n_items = sim.shape[0]
    pair_share = bonds.adj.nnz / (n_items * (n_items - 1))
    overlap = bonds.adj.multiply(tree.adj).sum() / max(bonds.adj.sum(), 1)
    knn_overlap = graphs[1].adj.multiply(tree.adj).sum() / max(graphs[1].adj.sum(), 1)
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
            f"Every graph is tested at the curated tree's density ({k} links per exercise), so a gain cannot "
            "come from simply seeing more of the student's history.",
            "",
            "## Atom's own bond rule",
            "",
            f"Atom links two topics when the cosine similarity of their 384-d text embeddings is at least "
            f"{BOND_MIN_SIM}. On these exercise names (multilingual MiniLM, the same size as Atom's vectors) that rule "
            f"links {pair_share:.0%} of all pairs: {np.diff(bonds.adj.indptr).mean():.0f} neighbours per exercise "
            f"out of {n_items - 1:,}. Median pairwise cosine is {np.median(sims):.2f} (90th percentile "
            f"{np.quantile(sims, 0.9):.2f}): sentence-embedding spaces are anisotropic, so a fixed threshold that "
            "looks selective links nearly everything, and the \"neighbours\" are most of the student's history, "
            f"which the base model already summarizes as overall accuracy. Only {overlap:.1%} of its links fall "
            f"inside a curated topic group, against {knn_overlap:.1%} for the {k}-nearest-neighbour version tested "
            "above. In the deployed app there is no embedding model at all (Ollama Cloud serves none), so the "
            "vectors are hashes of the text and the similarities are noise.",
            "",
        ]
    )  # fmt: skip
    write_report("graph", text)
    return text
