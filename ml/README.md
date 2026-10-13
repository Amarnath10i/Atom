# Atom ML

Atom (LAMA) is a JEE/NEET tutor whose memory graph, until now, was made of
hand-set numbers:
- **Topic mastery:** a topic's mastery moved by +0.05, −0.08 or −0.18 after a
  mock test, or by whatever delta the chat LLM proposed.
- **Forgetting:** a fixed `exp(−days / (1.5 + 2·reviews + 3))`.
- **Similarity bonds:** cosine ≥ 0.45 between text embeddings. In the deployed
  configuration, with no embedding model on Ollama Cloud, those embeddings were
  hashes of the text.

None of those numbers was ever checked against what students actually get right.

This package replaces them with models trained on real learner data, measures
them on learners they never saw, and ships the winner to the app:

## Results

All numbers are on learners the models never saw, with 95% intervals from a
bootstrap over learners. Every table is in [`reports/`](reports/).

### Student model: will this student answer the next question correctly?

Junyi Academy, 3.2M attempts by 14,453 held-out students.

| model | AUC | log loss | calibration error |
|---|---|---|---|
| **Atom's mastery rule, as displayed** | 0.590 (0.587–0.592) | 0.985 | **0.409** |
| Exercise difficulty only | 0.685 | 0.559 | 0.003 |
| BKT per exercise | 0.736 | 0.529 | 0.007 |
| SAKT | 0.741 | 0.526 | 0.006 |
| **LightGBM on signals Atom records (shipped)** | **0.742 (0.739–0.745)** | **0.524** | **0.001** |
| Elo, student + topic ratings | 0.753 | 0.518 | 0.010 |
| DKT | 0.755 | 0.516 | 0.010 |
| LightGBM, all features | 0.761 | 0.510 | 0.001 |

- **Against the old rule.** The shipped model beats Atom's rule by +0.152 AUC
  (+0.150 to +0.155). The rule ranks students' right and wrong answers worse than a
  model that ignores the student and uses only exercise difficulty, and it
  displays about 35% mastery to students who get 70% right.
- **Features versus deep models.** Feature-engineered LightGBM beats both deep
  sequence models (DKT 0.755, SAKT 0.741) and BKT.
- **What shipping costs.** The model limited to what Atom records loses 0.019
  AUC to one that also knows each exercise's accuracy across all students.
  Adding hints and retries, which Atom doesn't log, would gain only +0.0005.
- **Ordering leakage, measured.** Ignoring the 15-minute ordering ambiguity
  inflates AUC by +0.0008: small, and measured rather than assumed.

### Does the topic graph carry signal?

Each graph is tested at the same density (8 links per exercise). The table
shows the gain over a base model with no topic evidence.

| links | gain in AUC |
|---|---|
| learned from co-performance | +0.0033 (+0.0031 to +0.0035) |
| curated topic tree | +0.0023 (+0.0022 to +0.0024) |
| 8 nearest names by embedding | +0.0007 (+0.0007 to +0.0008) |
| random (control) | +0.0000 |

- **Topic links help, a little.** Learned and curated links beat semantic
  similarity, which beats random.
- **Atom's own rule** (cosine ≥ 0.45) links 70% of all exercise pairs, because
  sentence-embedding spaces are anisotropic, and only 0.8% of its links fall
  inside a curated topic group.
- **In deployment the bonds are noise.** There is no embedding model there, so
  the vectors are hashes of the text.

### Forgetting: recall after a gap

| | Duolingo (scheduled reviews) | | Junyi (self-paced maths) | |
|---|---|---|---|---|
| model | MAE | AUC | MAE | AUC |
| Atom's recall formula | 0.252 | 0.537 | 0.314 | **0.418** |
| Constant (mean recall) | 0.174 | 0.500 | 0.269 | 0.500 |
| Half-life regression + word difficulty | 0.127 | 0.545 | 0.249 | 0.499 |
| LightGBM | 0.185 | 0.575 | 0.211 | 0.818 |

- **The paper replicates.** On Duolingo, half-life regression reproduces Settles
  & Meeder (ACL 2016): MAE 0.127, AUC 0.545 and half-life correlation 0.202,
  against the paper's 0.128, 0.538 and 0.201.
- **Atom's formula** does worse than predicting the average. It schedules a
  review 0.7 to 2.6 days after practice.
- **Self-paced practice can't measure forgetting.** On Junyi, every model that
  forgets with time scores *below* chance. Students return quickly after
  struggling and much later once they have moved on, so time since practice
  reflects choice, not memory.
- **What ships.** Review timing comes from the curve fitted on Duolingo's
  scheduled reviews. Mastery comes from the student model, whose predictions
  decline slightly with time since practice (0.709 at once, 0.692 after six
  months).

### Shipping

- **Exact serving parity.** Replaying 3,903 attempts of 200 held-out students
  through the agents service gives a largest feature difference of 0 and a
  largest probability difference of 5.6e-16.
- **The bug the replay caught.** Training accumulated features in float32, while
  serving uses float64. That moved 12% of served predictions, by up to 0.021,
  across tree splits. Training now computes in float64 like serving.
- **Size and speed.** The model is 0.73 MB. A mastery request for a student with
  1,000 answers on 85 topics takes 62 ms.

### LLM: the tutor and its generated questions

- **Not yet measured.** Two evaluations are implemented but have not been run
  to completion, so there are no numbers for them yet:
  - **Tutor accuracy on JEE Advanced** (JEEBench, 5 answers per problem, and
    whether agreement between the answers predicts mistakes):
    [`experiments/tutor.py`](atomml/experiments/tutor.py).
  - **Wrong answer keys** (how often LLM-written keys are wrong, and what a
    generator-verifier check catches):
    [`experiments/keys.py`](atomml/experiments/keys.py).
- **LaTeX inside JSON.** Generated questions carry LaTeX inside JSON, and strict
  parsing either rejects the reply (`\alpha` is an invalid escape) or silently
  corrupts it (`\frac` becomes a form feed). Atom then fell back to its static
  question bank without saying so. A lenient parser in `agents/llm.py` now keeps
  the LaTeX, with tests.


## Data

| dataset | what it is | used for |
|---|---|---|
| [Junyi Academy](https://www.kaggle.com/datasets/junyiacademy/learning-activity-public-dataset-by-junyi-academy) | 16.2M maths practice attempts by 72,758 students on 1,330 exercises in a 4-level topic tree, with difficulty, time taken and hints | student model, topic-graph test, maths forgetting curves |
| [Duolingo half-life regression](https://doi.org/10.7910/DVN/N8XJME) (Settles & Meeder, ACL 2016) | 12.9M vocabulary practice sessions with time since last practice and history | forgetting-curve benchmark |
| [JEEBench](https://huggingface.co/datasets/daman1209arora/jeebench) (Arora et al., EMNLP 2023) | 515 JEE Advanced problems with official answers | tutor reliability |

A Junyi exercise is a skill practised through many different problems, as an
Atom topic is practised through many generated questions; Junyi's level-4
topic group plays the part of Atom's exam unit.

## Evaluation protocol

- **Unseen students.** Junyi students are split 70/10/20 into train, validation (model
  selection, early stopping, calibration) and test. Every test attempt is
  predicted from that student's own earlier attempts only, which is Atom's
  situation with a new student.
- **A strict visibility rule.** Junyi timestamps are rounded to 15 minutes, and
  71% of attempts share their bucket with another exercise whose order is
  unknown. An attempt may see earlier buckets and earlier problems of its own
  exercise session, nothing else. Every model obeys it, including Elo
  (bucket-synchronous updates) and the deep models (bucket-level LSTM steps;
  an attention mask in SAKT). The cost of ignoring it is measured.
- **Outcome-side columns are never features of their own row.**
  `is_upgrade`, the attempt's own time, hints and retries all happen during or
  because of the answer.
- **Metrics.** AUC, log loss, Brier score and expected calibration error.
  Atom shows mastery as a percentage, so calibration matters as much as ranking.
- **Uncertainty.** A clustered bootstrap over students, because one student's
  attempts are correlated. AUC is computed as a weighted Mann-Whitney statistic,
  so all resamples reuse a single sort.

## Models

All are trained on the same students and scored on the same 3.2M held-out attempts.

| model | idea | file |
|---|---|---|
| Atom's rule | the app's mastery update and recall curve, reproduced line by line | [`kt/sequential.py`](atomml/kt/sequential.py) |
| BKT | two-state hidden Markov model per exercise, EM (Baum-Welch); the E-step is tested against brute-force path enumeration | [`kt/sequential.py`](atomml/kt/sequential.py) |
| Elo | student and per-topic ratings against item difficulty, K shrinking with experience (Pelánek 2016) | [`kt/sequential.py`](atomml/kt/sequential.py) |
| Logistic regression, LightGBM | on history features under the visibility rule, in three feature sets: *atom* (only what Atom records), *transferable* (+ hints, retries), *full* (+ each exercise's population accuracy) | [`kt/features.py`](atomml/kt/features.py) |
| DKT | LSTM over 15-minute buckets (Piech et al. 2015) | [`kt/deep.py`](atomml/kt/deep.py) |
| SAKT | self-attention over past attempts with the visibility rule as the mask (Pandey & Karypis 2019) | [`kt/deep.py`](atomml/kt/deep.py) |
| Half-life regression | recall = 2^(−Δ/h), h = 2^(θ·x), loss and gradient as in the paper, full-batch L-BFGS; gradient checked against finite differences | [`memory/models.py`](atomml/memory/models.py) |

## Serving

`uv run atomml export` writes the following into `agents/models/`:
- `student_model.npz`: the LightGBM trees, flattened into arrays.
- `student_model.json`: features, smoothing constants, half-life parameters and evaluation numbers.

[`agents/student_model.py`](../agents/student_model.py) does the following at serving time:
- rebuilds the 13 features from a student's answer list in plain Python;
- scores them with the NumPy tree evaluator [`agents/trees.py`](../agents/trees.py);
- returns, for each topic, mastery (the probability of a right answer to a medium question now), recall and the next review date.

Two checks keep training and serving identical:
- [`tests/test_student_model.py`](tests/test_student_model.py) compares serving and training features row by row on synthetic logs. A 0.01 change to one smoothing constant makes it fail.
- The `export` experiment replays real held-out students through the serving code and reports the largest feature and probability differences.

In the app:
- every graded mock-test answer is stored (`question_attempts`);
- topic mastery comes from the model, and `memory_atoms.mastery_source` records which topics are measured and which are still estimates from conversation;
- the "View Architecture" page shows each student how their mastery is measured, with the numbers above.

## Reproduce

```bash
cd ml
uv sync                               # Python 3.12, PyTorch with CUDA 12.6
uvx kaggle datasets download -d junyiacademy/learning-activity-public-dataset-by-junyi-academy -p data/raw/junyi --unzip
curl -L -o data/raw/hlr/learning_traces.13m.csv.gz https://dataverse.harvard.edu/api/access/datafile/3091087
curl -L -o data/raw/jeebench/test.json https://huggingface.co/datasets/daman1209arora/jeebench/resolve/main/test.json

uv run atomml deep     # DKT and SAKT on the GPU (a few minutes on an RTX 3050)
uv run atomml kt       # every student model, bootstrap intervals, cold start, ordering leakage
uv run atomml memory   # forgetting curves on Duolingo and Junyi
uv run atomml graph    # does evidence from linked topics help?
uv run atomml tutor    # JEEBench with gpt-oss:120b on Ollama Cloud (needs OLLAMA_API_KEY; ~2,600 calls, cached)
uv run atomml export   # write agents/models/ and replay held-out students through the serving code
uv run pytest          # synthetic-data tests: definitions, leakage, serving parity
```

## Limitations

- **Domain gap.** The student model is trained on Taiwanese K-12 maths, not
  JEE/NEET. The model class, features and calibration procedure transfer, but
  its calibration on JEE topics has to be re-checked once Atom has its own
  graded answers. The app now stores them (`question_attempts`).
- **Forgetting.** The forgetting curve comes from vocabulary reviews, and its
  discrimination is weak everywhere (AUC about 0.55). The word- and
  learner-level half-life fits stop at their 1,000-iteration cap without
  meeting L-BFGS's tolerance; their metrics match the 300-iteration fit to
  four decimals.
- **No online test yet.** The natural one: randomize students between the old
  rule and the model, and compare next-test gains on the topics each flagged.

