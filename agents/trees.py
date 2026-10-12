"""Evaluate a LightGBM model from its JSON dump with NumPy.

`booster.dump_model()` describes every tree as nested split nodes. This module
flattens them into arrays once and then walks all rows down all trees with
vectorized indexing, reproducing LightGBM's missing-value rules:

* missing_type "NaN":  NaN goes to the default side
* missing_type "Zero": 0 and NaN go to the default side
* missing_type "None": NaN is treated as 0.0, then compared normally

Only numerical "<=" splits are supported (the student model has no
categorical features); anything else raises instead of silently mis-scoring.
"""

from __future__ import annotations

import numpy as np

_MISSING = {"None": 0, "NaN": 1, "Zero": 2}
_ARRAYS = ("feature", "threshold", "left", "right", "default_left", "missing", "value", "roots")


class TreeEnsemble:
    def arrays(self) -> dict[str, np.ndarray]:
        """The flattened trees, for np.savez; far smaller than the JSON dump."""
        return {f"tree_{name}": getattr(self, name) for name in _ARRAYS}

    @classmethod
    def from_arrays(cls, arrays, feature_names: list[str]) -> TreeEnsemble:
        self = cls.__new__(cls)
        self.feature_names = list(feature_names)
        for name in _ARRAYS:
            setattr(self, name, np.asarray(arrays[f"tree_{name}"]))
        return self

    def __init__(self, model: dict) -> None:
        self.feature_names = model["feature_names"]
        feature, threshold, left, right, default_left, missing, value = ([] for _ in range(7))
        self.roots = []

        def add(node: dict) -> int:
            idx = len(feature)
            for col in (feature, threshold, left, right, default_left, missing, value):
                col.append(0)
            if "leaf_value" in node:
                feature[idx], value[idx] = -1, node["leaf_value"]
                return idx
            if node["decision_type"] != "<=":
                raise ValueError(f"unsupported split {node['decision_type']}")
            feature[idx] = node["split_feature"]
            threshold[idx] = node["threshold"]
            default_left[idx] = node["default_left"]
            missing[idx] = _MISSING[node["missing_type"]]
            left[idx] = add(node["left_child"])
            right[idx] = add(node["right_child"])
            return idx

        for tree in model["tree_info"]:
            self.roots.append(add(tree["tree_structure"]))
        self.feature = np.array(feature, dtype=np.int32)
        self.threshold = np.array(threshold, dtype=np.float64)
        self.left = np.array(left, dtype=np.int32)
        self.right = np.array(right, dtype=np.int32)
        self.default_left = np.array(default_left, dtype=bool)
        self.missing = np.array(missing, dtype=np.int8)
        self.value = np.array(value, dtype=np.float64)
        self.roots = np.array(self.roots, dtype=np.int32)

    def predict(self, x: np.ndarray, chunk: int = 4096) -> np.ndarray:
        """Raw score (sum of leaf values) per row."""
        x = np.asarray(x, dtype=np.float64)
        if x.shape[0] > chunk:  # bound the (rows, trees) work arrays
            return np.concatenate([self.predict(x[s : s + chunk]) for s in range(0, len(x), chunk)])
        n = x.shape[0]
        if n == 0:
            return np.zeros(0)
        node = np.tile(self.roots, (n, 1))  # (rows, trees)
        rows = np.arange(n)[:, None]
        while True:
            f = self.feature[node]
            internal = f >= 0
            if not internal.any():
                break
            v = x[rows, np.where(internal, f, 0)]
            nan = np.isnan(v)
            miss = self.missing[node]
            to_default = (nan & (miss == 1)) | ((miss == 2) & (nan | (v == 0)))
            v = np.where(nan, 0.0, v)
            go_left = np.where(to_default, self.default_left[node], v <= self.threshold[node])
            nxt = np.where(go_left, self.left[node], self.right[node])
            node = np.where(internal, nxt, node)
        return self.value[node].sum(axis=1)
