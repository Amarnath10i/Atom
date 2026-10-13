# Knowledge tracing: predicting a student's next answer (Junyi Academy)

16,217,311 attempts by 72,758 students on 1,330 math exercises. Models are trained on 70% of students, tuned on 10% and scored on every attempt of the remaining 14,453 students (3,233,649 attempts), each predicted from that student's visible history only. 95% intervals from a bootstrap over students.

| model                                                      | AUC                    | log loss               |   Brier |    ECE |
|:-----------------------------------------------------------|:-----------------------|:-----------------------|--------:|-------:|
| Item difficulty only (population accuracy of the exercise) | 0.6852 (0.6817-0.6883) | 0.5593 (0.5543-0.5630) |  0.1891 | 0.0029 |
| Atom today: mastery rule, as displayed                     | 0.5896 (0.5872-0.5923) | 0.9845 (0.9811-0.9885) |  0.3696 | 0.4094 |
| Atom today: mastery rule, recalibrated                     | 0.5896 (0.5872-0.5923) | 0.5923 (0.5860-0.5961) |  0.2018 | 0.0269 |
| BKT per exercise (EM)                                      | 0.7362 (0.7334-0.7391) | 0.5291 (0.5245-0.5323) |  0.1763 | 0.0072 |
| Elo, student + per-topic rating                            | 0.7528 (0.7501-0.7560) | 0.5180 (0.5134-0.5217) |  0.1721 | 0.0095 |
| Logistic regression, signals Atom records                  | 0.7346 (0.7315-0.7381) | 0.5298 (0.5253-0.5335) |  0.1763 | 0.0065 |
| LightGBM, signals Atom records                             | 0.7418 (0.7387-0.7452) | 0.5240 (0.5195-0.5278) |  0.1741 | 0.001  |
| Logistic regression, transferable features                 | 0.7351 (0.7320-0.7386) | 0.5294 (0.5248-0.5331) |  0.1761 | 0.007  |
| Logistic regression, full features                         | 0.7526 (0.7499-0.7557) | 0.5173 (0.5127-0.5208) |  0.1716 | 0.0042 |
| LightGBM, transferable features                            | 0.7422 (0.7392-0.7456) | 0.5236 (0.5190-0.5273) |  0.1739 | 0.001  |
| LightGBM, full features                                    | 0.7612 (0.7585-0.7642) | 0.5101 (0.5055-0.5138) |  0.169  | 0.0009 |
| DKT (LSTM over attempts)                                   | 0.7550 (0.7523-0.7581) | 0.5161 (0.5115-0.5197) |  0.1712 | 0.0099 |
| SAKT (self-attention over attempts)                        | 0.7412 (0.7387-0.7442) | 0.5260 (0.5211-0.5294) |  0.1754 | 0.0055 |

## Paired differences in AUC (same attempts, bootstrap over students)

| comparison | AUC difference (95% interval) |
|---|---|
| LightGBM, signals Atom records vs Atom today: mastery rule, recalibrated | +0.1521 (+0.1497 to +0.1546) |
| LightGBM, full features vs Atom today: mastery rule, recalibrated | +0.1716 (+0.1693 to +0.1739) |
| LightGBM, full features vs Elo, student + per-topic rating | +0.0084 (+0.0080 to +0.0089) |
| Elo, student + per-topic rating vs BKT per exercise (EM) | +0.0166 (+0.0155 to +0.0180) |
| LightGBM, transferable features vs LightGBM, signals Atom records | +0.0005 (+0.0004 to +0.0005) |
| LightGBM, full features vs LightGBM, transferable features | +0.0190 (+0.0184 to +0.0195) |

## A student's first attempts

AUC by how many attempts the student had made before (0.4% of test attempts are a student's very first).

| model                                  |   attempts 0-9 |   attempts 10-49 |   attempts 50-199 |   attempts 200- |
|:---------------------------------------|---------------:|-----------------:|------------------:|----------------:|
| Atom today: mastery rule, recalibrated |         0.5412 |           0.5802 |            0.5926 |          0.5917 |
| BKT per exercise (EM)                  |         0.7255 |           0.7374 |            0.7423 |          0.7336 |
| Elo, student + per-topic rating        |         0.7172 |           0.7466 |            0.7575 |          0.7537 |
| LightGBM, signals Atom records         |         0.6953 |           0.7311 |            0.7452 |          0.7445 |
| LightGBM, full features                |         0.7347 |           0.7552 |            0.7648 |          0.762  |
| DKT (LSTM over attempts)               |         0.7252 |           0.7486 |            0.7595 |          0.7557 |
| SAKT (self-attention over attempts)    |         0.7252 |           0.7425 |            0.7473 |          0.739  |

## What ordering a 15-minute bucket arbitrarily would have reported

The same LightGBM (full features) built with every earlier row in sort order visible, including other exercises answered in the same bucket: AUC +0.0009 (+0.0007 to +0.0010) against the strict rule. That gain is leakage, not skill.

Elo tuned on validation students: alpha = 0.2, beta = 0.01.

## What LightGBM relies on (signals Atom records, share of split gain)

| feature | share |
|---|---|
| acc_item | 0.699 |
| acc_all | 0.117 |
| acc_in_session | 0.040 |
| acc_topic | 0.030 |
| last_log_sec | 0.027 |
| difficulty | 0.024 |
| n_item | 0.022 |
| last_correct | 0.011 |
| n_in_session | 0.009 |
| n_all | 0.007 |
| mean_log_sec | 0.006 |
| n_topic | 0.005 |
