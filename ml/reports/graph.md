# Does the topic graph carry signal? (Junyi Academy, test students)

LightGBM on each student's own history with the exercise, then the same model with the student's earlier attempts and accuracy on the exercise's linked exercises added, one graph at a time. Gains are paired AUC differences on the same test attempts (bootstrap over students).

| evidence added   | links per exercise   |    AUC | gain over base               |
|:-----------------|:---------------------|-------:|:-----------------------------|
| none (base)      | -                    | 0.7399 | -                            |
| tree             | 8.3 (median 8)       | 0.7422 | +0.0023 (+0.0022 to +0.0024) |
| embedding_knn    | 8.0 (median 8)       | 0.7406 | +0.0007 (+0.0007 to +0.0008) |
| random           | 8.3 (median 8)       | 0.7399 | +0.0000 (-0.0000 to +0.0001) |
| learned          | 7.8 (median 8)       | 0.7432 | +0.0033 (+0.0031 to +0.0035) |

Every graph is tested at the curated tree's density (8 links per exercise), so a gain cannot come from simply seeing more of the student's history.

## Atom's own bond rule

Atom links two topics when the cosine similarity of their 384-d text embeddings is at least 0.45. On these exercise names (multilingual MiniLM, the same size as Atom's vectors) that rule links 70% of all pairs: 936 neighbours per exercise out of 1,329. Median pairwise cosine is 0.53 (90th percentile 0.70): sentence-embedding spaces are anisotropic, so a fixed threshold that looks selective links nearly everything, and the "neighbours" are most of the student's history, which the base model already summarizes as overall accuracy. Only 0.8% of its links fall inside a curated topic group, against 21.3% for the 8-nearest-neighbour version tested above. In the deployed app there is no embedding model at all (Ollama Cloud serves none), so the vectors are hashes of the text and the similarities are noise.
