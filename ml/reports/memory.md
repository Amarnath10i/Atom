# Forgetting curves: predicting recall after a gap

## Duolingo vocabulary (13M sessions)

Train on the first 80% of time, tune on the next 10%, test on the last 10%. 10,283,365 training and 1,285,428 test sessions (26,028 test learners); mean recall in test 0.896. Intervals: bootstrap over learners.

| model                                                       | MAE                    | AUC                    |   log loss |   half-life Spearman |
|:------------------------------------------------------------|:-----------------------|:-----------------------|-----------:|---------------------:|
| Constant (mean recall)                                      | 0.1743 (0.1729-0.1759) | 0.5000 (0.5000-0.5000) |     0.3348 |                      |
| Atom today: exp(-days / (1.5 + 2 reviews + 3))              | 0.2521 (0.2483-0.2551) | 0.5366 (0.5279-0.5449) |     0.9832 |                      |
| Atom's form, refitted: exp(-days / (491.5 + -0.04 reviews)) | 0.1158 (0.1137-0.1178) | 0.5423 (0.5363-0.5492) |     0.7441 |                      |
| Leitner                                                     | 0.2323 (0.2294-0.2349) | 0.5501 (0.5447-0.5557) |     1.1569 |                      |
| Pimsleur                                                    | 0.4735 (0.4688-0.4784) | 0.5127 (0.5043-0.5207) |     5.1037 |                      |
| HLR, practice history only                                  | 0.1273 (0.1249-0.1291) | 0.5463 (0.5421-0.5521) |     0.6799 |                0.16  |
| HLR + word difficulty                                       | 0.1271 (0.1247-0.1289) | 0.5451 (0.5404-0.5506) |     0.6794 |                0.202 |
| HLR + word difficulty + learner stability                   | 0.1260 (0.1236-0.1279) | 0.5477 (0.5434-0.5533) |     0.6766 |                0.24  |
| LightGBM (history, time gap, word and learner statistics)   | 0.1845 (0.1830-0.1863) | 0.5753 (0.5691-0.5814) |     0.3356 |                      |

When each model would schedule the next review (predicted recall falls to 90%):

| history           |   Atom today (days) |   HLR (days) |
|:------------------|--------------------:|-------------:|
| 1 right, 0 wrong  |                 0.7 |         26.1 |
| 3 right, 0 wrong  |                 1.1 |         25.7 |
| 5 right, 0 wrong  |                 1.5 |         25.4 |
| 10 right, 0 wrong |                 2.6 |         24.9 |
| 5 right, 3 wrong  |                 2.2 |         22.7 |

## Junyi maths practice (returning to an exercise after a gap)

Split by student (70/10/20), as in the knowledge-tracing experiments; the target is the share right in the session when the student comes back. 1,417,247 training and 399,252 test sessions (11,592 test learners); mean recall in test 0.757. Intervals: bootstrap over learners.

| model                                                       | MAE                    | AUC                    |   log loss |   half-life Spearman |
|:------------------------------------------------------------|:-----------------------|:-----------------------|-----------:|---------------------:|
| Constant (mean recall)                                      | 0.2687 (0.2670-0.2706) | 0.5000 (0.5000-0.5000) |     0.5544 |                      |
| Atom today: exp(-days / (1.5 + 2 reviews + 3))              | 0.3141 (0.3096-0.3183) | 0.4181 (0.4138-0.4225) |     1.5179 |                      |
| Atom's form, refitted: exp(-days / (237.4 + -0.14 reviews)) | 0.2504 (0.2459-0.2553) | 0.4318 (0.4272-0.4361) |     1.7347 |                      |
| Leitner                                                     | 0.2786 (0.2735-0.2829) | 0.6754 (0.6712-0.6794) |     1.5275 |                      |
| Pimsleur                                                    | 0.4804 (0.4758-0.4846) | 0.4681 (0.4640-0.4732) |     4.1483 |                      |
| HLR, practice history only                                  | 0.2499 (0.2453-0.2548) | 0.4822 (0.4782-0.4864) |     1.5992 |                0.427 |
| HLR + exercise difficulty                                   | 0.2486 (0.2440-0.2533) | 0.4992 (0.4950-0.5032) |     1.5642 |                0.512 |
| LightGBM (history, time gap, exercise statistics)           | 0.2107 (0.2083-0.2126) | 0.8184 (0.8145-0.8221) |     0.4757 |                      |

When each model would schedule the next review (predicted recall falls to 90%):

| history           |   Atom today (days) |   HLR (days) |
|:------------------|--------------------:|-------------:|
| 1 right, 0 wrong  |                 0.7 |         22.4 |
| 3 right, 0 wrong  |                 1.1 |         24   |
| 5 right, 0 wrong  |                 1.5 |         25.3 |
| 10 right, 0 wrong |                 2.6 |         28   |
| 5 right, 3 wrong  |                 2.2 |         15.8 |

Every model that forgets with time ranks these sessions worse than chance (AUC below 0.5): students who return to an exercise after a long gap do better, not worse. That is selection, not memory: in a self-paced practice log, students come back quickly after struggling and much later once they have moved on, so when they return depends on how well they know it. Forgetting cannot be measured cleanly from such a log, and the review schedule Atom ships is not fitted on it.
