"""Train the visit-ranking model and write packages/core/model/risk_model.json.

The ranking answers one question for the CHO each morning: among everyone on
the register, who is most likely to have a complication in the next two weeks?
It is a logistic regression over features the register already holds
(packages/core/src/scorer.ts computes the same features on the phone).

There is no labelled Ghanaian dataset yet, so training data is synthetic: a
population is drawn per client type, and outcomes are generated from published
effect sizes (odds ratios below, rounded from the cited literature). The model
is then fitted on that data, as it will later be fitted on real visit outcomes
from a pilot. Validation here therefore checks the pipeline and the ranking
quality on the synthetic population, not clinical accuracy.

Usage:
    .venv/bin/python train.py            # train, evaluate, write the JSON
    .venv/bin/python train.py --check    # also assert quality thresholds
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

OUT = Path(__file__).resolve().parent.parent / "packages" / "core" / "model" / "risk_model.json"
SEED = 20261022

# Feature order matches the weights the phone reads.
FEATURES = [
    "anc_overdue_days",
    "days_postpartum_lt7",
    "no_pnc_visit",
    "prior_complications",
    "low_birth_weight",
    "muac_class",
    "followup_due_days",
    "first_pregnancy",
]

# Odds ratios for a complication within 14 days, per unit of each feature.
# Sources, rounded: most maternal and newborn deaths fall in the first week after
# birth (WHO postnatal care guidelines, 2022); missed postnatal contact (Ghana
# DHS 2022 secondary analyses); recurrence of postpartum haemorrhage and
# pre-eclampsia (systematic reviews, OR about 3); low birth weight and neonatal
# mortality (Lancet Every Newborn series, RR 3 to 4); MUAC yellow and red bands
# and mortality (WHO/UNICEF 2009 joint statement); missed ANC contacts (WHO 2016
# ANC model); overdue follow-up as an operational proxy for unresolved illness.
ODDS_RATIOS = {
    "anc_overdue_days": 1.015,  # per day, about 1.1 per week
    "days_postpartum_lt7": 4.0,
    "no_pnc_visit": 1.8,
    "prior_complications": 3.0,
    "low_birth_weight": 3.0,
    "muac_class": 2.3,  # per band: green 0, yellow 1, red 2
    "followup_due_days": 1.08,  # per day overdue
    "first_pregnancy": 1.3,
}
BASE_RATE = 0.04  # complication within 14 days with no risk factor present

REASON_TEMPLATES = {
    "anc_overdue_days": "ANC contact {days} days overdue",
    "days_postpartum_lt7": "{days} days after delivery",
    "no_pnc_visit": "no postnatal visit recorded",
    "prior_complications": "previous {complication}",
    "low_birth_weight": "low birth weight",
    "muac_class": "MUAC {colour}",
    "followup_due_days": "follow-up due {days} days ago",
    "first_pregnancy": "first pregnancy",
}


def draw_population(n: int, rng: np.random.Generator) -> np.ndarray:
    """Feature rows for a mixed catchment: pregnant women, recent mothers, newborns, under-fives."""
    kind = rng.choice(["pregnant", "postpartum", "newborn", "child"], size=n, p=[0.25, 0.15, 0.15, 0.45])
    x = np.zeros((n, len(FEATURES)))
    col = {f: i for i, f in enumerate(FEATURES)}
    for i, k in enumerate(kind):
        if k == "pregnant":
            x[i, col["anc_overdue_days"]] = min(28, max(0, rng.normal(6, 9)))
            x[i, col["first_pregnancy"]] = rng.random() < 0.25
            x[i, col["prior_complications"]] = rng.random() < 0.12
        elif k in ("postpartum", "newborn"):
            days = rng.integers(0, 43)
            x[i, col["days_postpartum_lt7"]] = days < 7
            x[i, col["no_pnc_visit"]] = rng.random() < (0.55 if days < 7 else 0.3)
            if k == "postpartum":
                x[i, col["prior_complications"]] = rng.random() < 0.15
            else:
                x[i, col["low_birth_weight"]] = rng.random() < 0.12
        else:
            x[i, col["low_birth_weight"]] = rng.random() < 0.08
            x[i, col["muac_class"]] = rng.choice([0, 1, 2], p=[0.82, 0.13, 0.05])
        if rng.random() < 0.15:
            x[i, col["followup_due_days"]] = rng.integers(0, 10)
    return x


def simulate_outcomes(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    logit = math.log(BASE_RATE / (1 - BASE_RATE)) + x @ np.array([math.log(ODDS_RATIOS[f]) for f in FEATURES])
    return rng.random(len(x)) < 1 / (1 + np.exp(-logit))


def precision_at_k(scores: np.ndarray, y: np.ndarray, k: int, days: int, rng: np.random.Generator) -> float:
    """Average share of real cases among the top k of a CHO's daily catchment of about 250 clients."""
    hits = []
    for _ in range(days):
        idx = rng.choice(len(y), size=250, replace=False)
        top = idx[np.argsort(-scores[idx])[:k]]
        hits.append(y[top].mean())
    return float(np.mean(hits))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail unless the model clears the quality thresholds")
    args = parser.parse_args()

    rng = np.random.default_rng(SEED)
    x = draw_population(60_000, rng)
    y = simulate_outcomes(x, rng)
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.25, random_state=SEED, stratify=y)

    model = LogisticRegression(max_iter=1000, C=10.0)
    model.fit(x_train, y_train)
    scores = model.decision_function(x_test)

    auc = roc_auc_score(y_test, scores)
    # The best any model can do on this data: rank by the true generating risk.
    true_logit = x_test @ np.array([math.log(ODDS_RATIOS[f]) for f in FEATURES])
    auc_ceiling = roc_auc_score(y_test, true_logit)
    eval_rng = np.random.default_rng(SEED + 1)
    p10 = precision_at_k(scores, y_test, 10, 200, eval_rng)
    p10_random = precision_at_k(eval_rng.random(len(y_test)), y_test, 10, 200, eval_rng)
    p10_postpartum_only = precision_at_k(x_test[:, FEATURES.index("days_postpartum_lt7")] + eval_rng.random(len(y_test)) * 0.01, y_test, 10, 200, eval_rng)

    weights = {f: round(float(w), 4) for f, w in zip(FEATURES, model.coef_[0])}
    out = {
        "version": 2,
        "source": "model/train.py: logistic regression on a synthetic, literature-calibrated population; refit on pilot outcomes",
        "intercept": round(float(model.intercept_[0]), 4),
        "weights": weights,
        "reason_templates": REASON_TEMPLATES,
        "evaluation": {
            "population": len(x),
            "prevalence": round(float(y.mean()), 4),
            "auc": round(float(auc), 3),
            "auc_ceiling": round(float(auc_ceiling), 3),
            "precision_at_10": round(p10, 3),
            "precision_at_10_random": round(p10_random, 3),
            "precision_at_10_days_postpartum_only": round(p10_postpartum_only, 3),
        },
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps(out["evaluation"], indent=2))
    print("weights", json.dumps(weights))

    if args.check:
        assert auc >= auc_ceiling - 0.01, f"AUC {auc:.3f} falls short of the {auc_ceiling:.3f} the data allows"
        assert p10 > 2 * p10_random, "ranking is not clearly better than a random list"
        assert all(w > 0 for w in weights.values()), "a risk factor came out protective"
        print("check passed")


if __name__ == "__main__":
    main()
