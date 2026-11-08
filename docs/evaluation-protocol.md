# Evaluation protocol: recognition accuracy and processing latency

**Research objective 4.** To evaluate the recognition accuracy and processing latency of the
developed prototype using a limited sample of grocery products currently sold by the
researcher in Lesotho. Results are reported in **Chapter 4.5**.

This protocol fixes the method *before* data is collected, so that the results can be repeated
and defended. Deviations during data collection should be written down and reported.

---

## 1. What is evaluated

The system under test is the prototype's **visual identification** of items without a barcode
(Till → *Non-barcode*). It works in five steps:

1. A YOLOv8n detector finds the item in the camera frame. It runs at most 8 times a second.
2. Once the item is held still for 3 frames, the item is cropped and a MobileNetV2 embedder turns
   it into a 1,280-number vector. This happens at most 2 times a second.
3. The vector is compared, by cosine similarity, with the stored vectors from each product's
   photos.
4. A product is **locked in** when it wins 2 of the last 3 views. Winning means a similarity of at
   least 0.60 and a lead of at least 0.03 over the runner-up.
5. The cashier sees the top 3 products.

The models, thresholds and code are the ones that ship. Nothing is tuned for the evaluation.

## 2. Instruments

| | Instrument | Measures | Where |
|---|---|---|---|
| A | **In-app Evaluation mode** (Menu → Evaluation) | Real-world accuracy, end-to-end recognition time, and the latency of every pipeline stage, on the phone | Phone |
| B | **Model benchmark** (inside Evaluation mode) | Pure inference and matching time on fixed input, with no camera and no pacing | Phone |
| C | **Offline photo-set evaluation** (`ml/scripts/eval_matching.py`) | Reproducible per-view accuracy on a fixed photo set; a sweep that justifies the 0.60 threshold | PC |

Instrument A runs the same camera pipeline, vector index and voting rule as the till. During
evaluation it **never** learns from a trial, adds anything to the cart, or changes shop data.
Results are saved as files outside the shop database.

Instrument C uses a desktop copy of the app's preprocessing. It was checked against the app's
code and gives **identical model inputs** (maximum difference 0.0), the same detected box and
the same crop. The one known difference is the filter used to shrink the photo to 448 px.

## 3. Sample

### 3.1 Products (known items)
- **15–20 grocery products currently sold in the shop that have no usable barcode.**
  Examples: loose fruit and vegetables, bread, loose sweets, products sold in reused containers,
  and locally packed goods.
- On purpose, include some **look-alike pairs**, such as two breads, two maize meal brands, or
  apples and tomatoes. They show where the system confuses products.
- Record each product's name, category and packaging in a table (Appendix X).

### 3.2 Unknown items (open-set test)
- **About 10 items that are NOT given photos in the app.** For these, the correct answer is "no
  match". They measure the **false-accept rate**: how often the system confidently names the
  wrong product for something it has never seen.

### 3.3 Number of trials
- **Live trials (A):** 5 trials per product in each of the 2 conditions. With 20 products this
  gives 200 known-item trials, plus 3 trials per unknown item in each condition (60 trials).
- **Precision this gives:** with 100 trials and 90% accuracy, the 95% confidence interval is
  82.6–94.5%. With 150 trials it narrows to 84.2–93.8%. With 50 trials it is 78.6–95.7%.
  Report the interval, not only the percentage.

### 3.4 Conditions
| Factor | Levels |
|---|---|
| Lighting | Good light (daylight or shop lights on); Dim light (lights off or evening) |
| Background | Plain counter; Cluttered (other goods behind the item) |

Use at least two combinations: **Good light / Plain counter**, which is typical, and
**Dim light / Cluttered**, which is hard. Use all four if time allows. Select the condition on
the Evaluation screen before each block of trials.

## 4. Preparation

1. **Build.** Install a **release** build with evaluation turned on. Development builds run the
   models several times slower, and their latency must not be reported.
   ```bash
   # mobile/.env.local
   EXPO_PUBLIC_EVALUATION=1
   # then
   cd mobile && npx expo run:android --variant release
   ```
   The Evaluation screen states which build it is running in, and every export records it.
2. **Phone.** Use the lowest-specification phone the shop would realistically use. Record its
   model, Android version and RAM (recorded automatically). Before each session:
   - charge the battery above 50% and unplug it;
   - close other apps;
   - let the phone cool if it is warm;
   - turn airplane mode on, so sync does not compete for the processor.
3. **Enrolment.** Add 1–2 photos to each test product through the normal product form, in
   ordinary shop light. **Do not take enrolment photos in the same session as the trials.** Open
   the Evaluation screen and check that every product shows stored views (2 per photo).
4. **Signing in.** Sign in as the shop owner. Only owners see Menu → Evaluation.

## 5. Procedure

### 5.1 Live trials (instrument A)
1. Menu → **Evaluation** → name the run (for example "Counter, morning, good light") →
   **Start a new run**.
2. Select the **conditions** chips.
3. Put the products in a **random order** (draw numbered slips, or use a random-number list).
   Work through the list 5 times rather than doing 5 trials of one product in a row.
4. For each trial:
   1. Tap **Choose** and pick the product you are holding, or type the name of an unknown item.
   2. Hold the item **out of view** and tap **Start trial**.
   3. Bring the item into the guide square at the normal working distance and hold it still, as a cashier would.
   4. The trial ends when the system locks a match, or after **10 s** (a time-out).
   5. **Keep** the trial. **Discard** it only for a procedural error that was decided in advance:
      the wrong item was chosen, the item was dropped or fully covered by a hand, or the screen
      was interrupted. Count the discarded trials and give the reasons in the thesis.
5. The first trial of every session is a **warm-up**: discard it.
6. Runs save automatically after every kept trial. Several runs (days, conditions, phones) are
   combined during analysis.

### 5.2 Model benchmark (instrument B)
At the start and at the end of each session, tap **Benchmark models**, keep the phone still with
the screen on, then tap **Save to run**. It runs each stage 10 times untimed, then 100 times timed:
- detector inference;
- embedder inference;
- embedder preprocessing;
- the index search over all stored views.

### 5.3 Export
For each run, tap **Export** and choose a folder (for example Downloads). This writes:
- `eval-<date>-<name>-<id>.json`, the complete record, used for analysis;
- a `.csv` file with one row per trial, for a spreadsheet.

Copy these files to the PC.

### 5.4 Offline photo set (instrument C)
1. Take **2 enrolment photos** and **5 query photos** of each product with the same phone, at
   different times, angles and distances from the enrolment photos. Take **2–3 query photos** of
   each unknown item.
2. Arrange them like this (the folder name is the product name):
   ```
   ml/data/eval/
     enrol/<product>/*.jpg
     query/<product>/*.jpg
     query/_unknown/*.jpg
   ```
   `ml/data/` is git-ignored: the shop's photos stay on the PC.
3. Run:
   ```bash
   cd ml
   uv run python scripts/eval_matching.py --enrol-dir data/eval/enrol --query-dir data/eval/query
   ```

## 6. Measures

**Known trials** are trials of products that have photos. **Unknown trials** are trials of items
that have none.

| Measure | Definition |
|---|---|
| **Top-1 accuracy** | Known trials that locked to the right product ÷ known trials |
| **Top-3 hit rate** | Known trials where the right product was among the 3 shown ÷ known trials |
| **Rank-1 accuracy** | Known trials whose first suggestion was right, threshold or not ÷ known trials |
| **Lock rate** | Known trials that locked to any product ÷ known trials |
| **Precision** | Known trials that locked to the right product ÷ known trials that locked |
| **False-accept rate** | Unknown trials that locked to some product ÷ unknown trials |
| **Overall correct decisions** | (right locks on known items + no lock on unknown items) ÷ all trials |
| **Stage latency** | Milliseconds per frame or view for each step: GPU resize, detector inference, box decoding, crop, embedder inference and index search. Pooled over all frames of all trials. Reported as mean ± SD, median, 90th and 95th percentile, and maximum. |
| **Time to lock** | From tapping *Start trial* to the locked match; also from the first frame showing the item to the locked match |
| **Throughput** | Detector frames processed per second during trials |

**How the numbers are worked out:**
- Proportions have **Wilson score 95% confidence intervals**. These remain valid for small
  samples and for rates near 0% or 100%.
- Percentiles use linear interpolation.
- The phone and the analysis scripts use the same definitions, and unit tests check that they
  give the same values.
- Timings use the phone's monotonic clock (`performance.now()`).

**Latency and time to lock are different things.**
- *Stage latency* is how long the computation takes.
- *Time to lock* also includes the pipeline's deliberate pacing: the frame-rate cap, 3 still
  frames, 2 embeddings a second, and 2-of-3 voting. These exist to prevent wrong matches. Time to
  lock is therefore always longer than the sum of the stage latencies.

Report both.

## 7. Analysis

```bash
cd ml
uv run python scripts/analyse_trials.py path/to/eval-*.json        # phone runs (A + B)
uv run python scripts/eval_matching.py --enrol-dir … --query-dir …  # photo set (C)
```

`analyse_trials.py` writes `ml/artifacts/chapter4_5/`:

| File | Contents |
|---|---|
| `chapter4_5.md` | Every table, ready to paste: setup, accuracy, per item, per condition, latency per stage, end-to-end timing, benchmark |
| `latency_stages.png` | Per-stage latency box plot |
| `time_to_lock.png` | Time-to-lock cumulative distribution |
| `product_accuracy.png` | Top-1 and top-3 per product |
| `confusion.png` | True product against predicted product |
| `trials.csv` | All trials, one row each |
| `summary.json` | The same numbers, machine-readable |

Development-build runs are left out of every latency table automatically.

`eval_matching.py` writes:
- a report (`.md`/`.json`), including a **threshold sweep**: accuracy, rejections and false
  accepts from 0.50 to 0.95, and a suggested threshold;
- a per-photo `.csv`;
- `_sweep.png` and `_confusion.png`.

## 8. Suggested structure for Chapter 4.5

- **4.5.1 Evaluation setup.** The phone, the build, the models, the sample of products and
  unknown items, the conditions and the number of trials (Table "Evaluation setup").
- **4.5.2 Recognition accuracy.** The accuracy table with confidence intervals.
  - Results per item and per condition.
  - The confusion matrix: name the products that were confused and explain why, such as similar
    packaging or colour.
  - The offline per-view accuracy and threshold sweep, as corroboration and as the justification
    for the 0.60 threshold.
- **4.5.3 Processing latency.**
  - The per-stage table and box plot. Which stage dominates?
  - The benchmark table, for pure inference.
  - The end-to-end table and time-to-lock chart. How long a cashier actually waits, and why that
    is longer than the computation.
- **4.5.4 Discussion and limitations.** See section 9.

## 9. Threats to validity (report these)

- **Sample size and scope.**
  - Products come from one shop and one researcher.
  - Fifteen to twenty products is a limited sample, as the objective states.
  - The confidence intervals show the uncertainty; do not generalise beyond them.
- **Embedder.**
  - MobileNetV2 is ImageNet-pretrained and has **not been fine-tuned** on these products.
  - Accuracy depends on the enrolment photos and on how distinctive the products look.
- **Researcher as operator.**
  - The researcher presents every item. This was mitigated by randomising the order and fixing
    the discard rules in advance.
  - The results describe a trained user.
- **Single-view versus voted decisions.**
  - Offline figures (C) are per-view.
  - Live figures (A) use 2-of-3 voting.
  - The two are expected to differ, and both are reported.
- **Hardware variance.**
  - Latency depends on the phone, its temperature and its battery state.
  - The phone is recorded in every export, and conditions were controlled as in section 4.
- **Time to lock includes deliberate pacing.**
  - It is reported separately from compute latency, so it is not read as model speed.
