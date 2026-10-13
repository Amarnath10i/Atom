# Shipping the student model

## What ships

LightGBM on the signals Atom records (13 features, 318 trees), served by agents/student_model.py with NumPy. On the held-out students: AUC 0.7418 (0.7387-0.7452), log loss 0.5240 (0.5195-0.5278), calibration error 0.0010. Atom's rule before it: AUC 0.5896 (0.5872-0.5923), calibration error as displayed 0.409.

- `agents/models/student_model.json`: 0.00 MB
- `agents/models/student_model.npz`: 0.73 MB

## Does the serving code reproduce the evaluated model?

3,903 attempts of 200 held-out students, each rebuilt from the student's attempt list by the agents service: largest feature difference 0.00e+00, largest probability difference 5.55e-16 against the offline features and LightGBM itself.

## Latency

Mastery for every topic of a student with 1,000 attempts on 85 topics: 61.8 ms per request.
