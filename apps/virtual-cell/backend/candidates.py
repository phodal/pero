"""Bounded additive proposals for genuinely unmeasured pairs, never acceptance.

The researcher freezes the transcript endpoint, time, meaningful effect, assay,
controls and cost budget. Ranking consumes training singles only. Observed
combinations (including held-out ones) cannot masquerade as new experiments.
This domain artifact introduces no execution or experimental task state.
"""
from baselines import baseline_mean
from contract import Invalid, context_field, digest, finite, sealed, text, validate_spec
from dataset import comparison_support, condition_id, readout_support, training_view
from split import check_split

PLAN_SCHEMA = "point.virtual-cell.candidate-plan.v1"
CANDIDATES_SCHEMA = "point.virtual-cell.candidates.v1"


def validate_plan(plan, spec, split, dataset):
    if not isinstance(plan, dict) or set(plan) != {
        "schema", "spec_digest", "split_digest", "objective", "budget", "controls", "candidates"
    } or plan["schema"] != PLAN_SCHEMA:
        raise Invalid("candidate_plan_schema")
    if plan["spec_digest"] != digest(spec) or plan["split_digest"] != split["digest"]:
        raise Invalid("candidate_plan_stale")
    objective = plan["objective"]
    if not isinstance(objective, dict) or set(objective) != {
        "readout", "gene", "direction", "min_effect", "scale", "assay", "sampling_time"
    }:
        raise Invalid("candidate_objective")
    if objective["readout"] != "transcript_expression" or objective["assay"] != "scRNA-seq":
        raise Invalid("candidate_endpoint_unsupported")
    # Both the frozen source artifact and its task context must agree with the
    # requested endpoint. A plan cannot relabel protein counts as transcripts.
    if any(objective[key] != dataset["measurement"][key] or objective[key] != spec["context"][key]["value"]
           for key in ("readout", "assay")):
        raise Invalid("candidate_source_measurement")
    if not text(objective["gene"], 64) or objective["direction"] not in ("increase", "decrease"):
        raise Invalid("candidate_objective")
    if not finite(objective["min_effect"]) or objective["min_effect"] <= 0:
        raise Invalid("candidate_effect_threshold")
    if objective["scale"] != dataset["scale"]:
        raise Invalid("candidate_endpoint_scale")
    context_field("sampling_time", objective["sampling_time"])
    budget = plan["budget"]
    if not isinstance(budget, dict) or set(budget) != {"max_candidates", "max_total_cost", "cost_unit"}:
        raise Invalid("candidate_budget")
    if (not isinstance(budget["max_candidates"], int) or isinstance(budget["max_candidates"], bool)
        or not 1 <= budget["max_candidates"] <= 400 or not finite(budget["max_total_cost"])
        or budget["max_total_cost"] <= 0 or not text(budget["cost_unit"], 64)):
        raise Invalid("candidate_budget")
    controls = plan["controls"]
    train = {dataset["control"], *split["assignments"]["train"]}
    if not isinstance(controls, list) or not 2 <= len(controls) <= 20:
        raise Invalid("candidate_controls")
    seen, roles = set(), set()
    for row in controls:
        if not isinstance(row, dict) or set(row) != {"condition", "role", "cost"}:
            raise Invalid("candidate_controls")
        cid, role = row["condition"], row["role"]
        if (not text(cid) or cid not in train or cid in seen or role not in ("positive", "negative")
            or (role == "negative") != (cid == dataset["control"])):
            raise Invalid("candidate_controls")
        seen.add(cid)
        roles.add(role)
        _cost(row["cost"])
    if roles != {"positive", "negative"}:
        raise Invalid("candidate_controls")
    if sum(r["cost"] for r in controls) > budget["max_total_cost"]:
        raise Invalid("candidate_controls_over_budget")
    rows = plan["candidates"]
    if not isinstance(rows, list) or not 0 < len(rows) <= 400:
        raise Invalid("candidate_queries")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"targets", "cost"}:
            raise Invalid("candidate_query")
        targets = row["targets"]
        if (not isinstance(targets, list) or len(targets) != 2 or not all(text(t, 64) for t in targets)
            or len(set(targets)) != 2 or condition_id(targets) in seen):
            raise Invalid("candidate_targets")
        seen.add(condition_id(targets))
        _cost(row["cost"])
    return digest(plan)


def _cost(value):
    if not finite(value) or value <= 0:
        raise Invalid("candidate_cost")


def propose(dataset, spec, split, plan):
    check_split(dataset, spec, split)
    validate_spec(spec)
    plan_digest = validate_plan(plan, spec, split, dataset)
    objective, budget = plan["objective"], plan["budget"]
    view = training_view(dataset, split)
    observed = {c["id"] for c in dataset["conditions"]}
    cells = {c["id"]: c["cells"] for c in dataset["conditions"]}
    source_time, desired_time = spec["context"]["time"], objective["sampling_time"]
    known_time = context_field("time", source_time) == context_field("sampling_time", desired_time) == "known"
    rows = []
    for query in plan["candidates"]:
        targets = sorted(query["targets"])
        cid = condition_id(targets)
        coverage = readout_support(view.genes, targets, [objective["gene"]])
        design = comparison_support(dataset, targets)
        reasons = []
        if cid in observed:
            reasons.append("already_observed")
        if not all(view.has(t) for t in targets):
            reasons.append("component_single_not_in_train")
        if any(cells.get(t, 0) < spec["split"]["min_cells"] for t in targets):
            reasons.append("component_low_support")
        if coverage["status"] != "complete":
            reasons.append("readout_coverage_incomplete")
        if design["status"] != "matched":
            reasons.append("control_matching_incomplete")
        if not known_time:
            reasons.append("sampling_time_unknown")
        elif source_time["value"] != desired_time["value"]:
            reasons.append("sampling_time_mismatch")
        if not split["feature_fit_eligible"]:
            reasons.append("feature_fit_ineligible")
        effect, score = None, None
        if not reasons:
            gene = view.genes.index(objective["gene"])
            effect = baseline_mean("additive", view, targets)[gene] - view.mean(view.control)[gene]
            score = effect if objective["direction"] == "increase" else -effect
            if score < objective["min_effect"]:
                reasons.append("below_effect_threshold")
        rows.append({"id": cid, "targets": targets, "cost": query["cost"], "predicted_delta": effect,
                     "score": score, "readouts": coverage, "design": design, "reasons": reasons,
                     "selection": "ineligible" if reasons else "pending"})
    # Deterministic effect ordering with a hard cost cap; not a knapsack optimum.
    total = sum(r["cost"] for r in plan["controls"])
    selected = []
    for row in sorted((r for r in rows if not r["reasons"]), key=lambda r: (-r["score"], r["id"])):
        if len(selected) >= budget["max_candidates"]:
            row["selection"] = "candidate_limit"
        elif total + row["cost"] > budget["max_total_cost"]:
            row["selection"] = "cost_limit"
        else:
            selected.append(row["id"])
            total += row["cost"]
            row["selection"] = "proposed_for_review"
    return sealed({
        "schema": CANDIDATES_SCHEMA, "plan_digest": plan_digest, "spec_digest": digest(spec),
        "split_digest": split["digest"], "dataset_digest": split["dataset_digest"],
        "method": "empirical_additive_train_singles_equal_batch.v1", "objective": objective,
        "status": "proposal_only", "ranking": "effect_descending_then_id_with_cost_cap",
        "controls": plan["controls"], "controls_status": "researcher_proposed_unvalidated",
        "budget": {**budget, "proposed_cost": total}, "selected_for_review": selected,
        "denominator": {"attempted": len(rows), "eligible": sum(not r["reasons"] for r in rows),
                        "proposed": len(selected), "ineligible": sum(bool(r["reasons"]) for r in rows)},
        "conditions": sorted(rows, key=lambda r: r["id"]),
        "scientific_evidence": "insufficient", "acceptance": "not_reviewed",
        "limitations": ["execution_isolation_unverified", "additive_proposal_not_experimental_support",
                        "guide_sensitivity_not_validated", "uncertainty_not_computed",
                        "human_candidate_and_control_confirmation_required"],
    })
