"""Independent analytic/70-digit Decimal reference cases for paper §6.3.

Goldens below were evaluated from the reduced expressions shown in each test,
with Decimal localcontext.prec=70, Decimal.sqrt and Decimal.ln. They do not call
production helpers or repeat the general scoring implementation. These are
synthetic mathematical cases, not the paper's experimental target/readout data.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'backend'))
from dataclasses import FrozenInstanceError
import math
import unittest

from paper_scoring import DyeFractions, TargetEstimate, parse_fractions, run_score_mnats, target_loss_nats

ZERO = DyeFractions(0, 0, 0, 0)
UNIFORM_HALF = DyeFractions(.125, .125, .125, .125)
UNIFORM_QUARTER = DyeFractions(.0625, .0625, .0625, .0625)
UNIFORM_FULL = DyeFractions(.25, .25, .25, .25)
RED_HALF = DyeFractions(.5, 0, 0, 0)
GREEN_HALF = DyeFractions(0, .5, 0, 0)


class PaperScoringTests(unittest.TestCase):
    def test_identical_fractions_have_zero_loss(self):
        for fractions in (ZERO, UNIFORM_HALF, UNIFORM_FULL, RED_HALF, DyeFractions(.1, .2, .3, .1)):
            with self.subTest(fractions=fractions):
                self.assertEqual(target_loss_nats(fractions, fractions), 0)
        with self.assertRaises(FrozenInstanceError):
            RED_HALF.red = .1

    def test_concentration_only_analytic_logarithm(self):
        # Equal relative shares cancel KL. Water .5→.75 changes logit by ln(3).
        # lambda=1/32, hence ln(3)^2/32 nats.
        expected = 0.03771715502539318680761809762029268480057697958216318702552271375181922
        self.assertAlmostEqual(target_loss_nats(UNIFORM_HALF, UNIFORM_QUARTER), expected, places=15)
        self.assertAlmostEqual(target_loss_nats(UNIFORM_QUARTER, UNIFORM_HALF), expected, places=15)

    def test_composition_only_analytic_swap_symmetry(self):
        # Equal total dye cancels water term. Set a=sqrt(1.03), b=sqrt(.03).
        # Swapping the dominant red/green entries gives (a-b)/(a+3b)*ln(a/b).
        expected = 0.9697896983512550461945572039402092283862515965169558958488629269889230
        self.assertAlmostEqual(target_loss_nats(RED_HALF, GREEN_HALF), expected, places=14)
        self.assertAlmostEqual(target_loss_nats(GREEN_HALF, RED_HALF), expected, places=14)

    def test_kl_direction_is_truth_to_estimate_not_symmetric(self):
        # With p=a/(a+3b), q=b/(a+3b), uniform→pure is
        # (ln(1/(4p))+3ln(1/(4q)))/4; reverse is p ln(4p)+3q ln(4q).
        forward = 0.3531774617568450573173634630643248759888163786454639972378043541203545
        reverse = 0.3741648120065962273285544398908320453008723187422529246488428411213381
        self.assertAlmostEqual(target_loss_nats(UNIFORM_HALF, RED_HALF), forward, places=14)
        self.assertAlmostEqual(target_loss_nats(RED_HALF, UNIFORM_HALF), reverse, places=14)
        self.assertNotEqual(forward, reverse)

    def test_zero_dyes_and_clipped_extremes(self):
        # F=0 has uniform shares. Against uniform full dye only water differs:
        # logits are ±ln(9999), loss = (2ln(9999))²/32 = ln(9999)²/8.
        expected = 10.60356595218392857711051342570470073336328048483886150008418297612678
        loss = target_loss_nats(ZERO, UNIFORM_FULL)
        self.assertTrue(math.isfinite(loss))
        self.assertAlmostEqual(loss, expected, places=11)
        # Both water fractions clip to .9999; both dye distributions are uniform.
        self.assertEqual(target_loss_nats(ZERO, DyeFractions(.0000025, .0000025, .0000025, .0000025)), 0)
        self.assertTrue(math.isfinite(target_loss_nats(ZERO, DyeFractions(1, 0, 0, 0))))

    def test_four_target_mean_in_millinats(self):
        # Independent sum of the three preceding analytic constants and identity,
        # divided by four, then multiplied by 1000 (not a sum or value in nats).
        expected = 2902.768201390144202528172181816300661637527265234495145739642154216880
        targets = (TargetEstimate(ZERO, ZERO), TargetEstimate(UNIFORM_HALF, UNIFORM_QUARTER),
                   TargetEstimate(RED_HALF, GREEN_HALF), TargetEstimate(ZERO, UNIFORM_FULL))
        self.assertAlmostEqual(run_score_mnats(targets), expected, places=9)
        self.assertEqual(run_score_mnats((TargetEstimate(RED_HALF, RED_HALF),) * 4), 0)

    def test_invalid_input_and_target_count(self):
        valid = {'red': .1, 'green': .2, 'blue': .3, 'yellow': .1}
        self.assertEqual(parse_fractions(valid), DyeFractions(.1, .2, .3, .1))
        invalid = [dict(valid, red=value) for value in (True, False, -.01, 1.01, 10**1000,
                   float('nan'), float('inf'), -float('inf'), '0.1', None)]
        invalid += [dict(valid, red=.5), dict(valid, water=.3), {}, [], None]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                parse_fractions(raw)
        for count in (0, 1, 3, 5):
            with self.subTest(count=count), self.assertRaises(ValueError):
                run_score_mnats((TargetEstimate(ZERO, ZERO),) * count)
