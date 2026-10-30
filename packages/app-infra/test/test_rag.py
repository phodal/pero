"""Fusion, cosine refusal, and the embedding-space signature."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_infra.embed import NullEmbedder, model_path
from app_infra.rag import fuse_hits, passage_input, query_input, space_signature, vector_ranks


class RagTest(unittest.TestCase):
    def test_vector_leg_outranks_a_weaker_keyword_hit(self):
        fused = fuse_hits(["lexical"], [("semantic", 1)])
        self.assertEqual(fused[0][0], "semantic")
        self.assertGreater(fused[0][1], fused[1][1])

    def test_absent_vector_leg_keeps_keyword_order(self):
        self.assertIsNone(fuse_hits(["a", "b"], []))

    def test_cosine_refuses_a_different_width_and_a_zero_vector(self):
        ranks = vector_ranks([1.0, 0.0], [("near", [0.8, 0.2]), ("wide", [1.0, 0.0, 0.0]), ("zero", [0.0, 0.0]), ("away", [-1.0, 0.0])])
        self.assertEqual(ranks, [("near", 1)])

    def test_signature_names_the_model_and_width(self):
        self.assertNotEqual(space_signature("qwen3-embedding:0.6b:abc", 1024), space_signature("qwen3-embedding:0.6b:def", 1024))
        self.assertNotEqual(space_signature("m", 1024), space_signature("m", 768))

    def test_query_and_passage_texts_differ(self):
        self.assertTrue(query_input("注意力").startswith("Instruct:"))
        self.assertIn("Query: 注意力", query_input("注意力"))
        self.assertEqual(passage_input("Title", "body"), "Title\nbody")
        self.assertNotIn("Instruct:", passage_input("Title", "body"))

    def test_runtime_image_matches_the_package(self):
        package = Path(__file__).resolve().parents[1] / "app_infra"
        image = Path(__file__).resolve().parents[3] / "apps" / "paper-agent" / "backend" / "app_infra"
        for name in ("__init__.py", "rag.py", "embed.py"):
            self.assertEqual((package / name).read_bytes(), (image / name).read_bytes(), name)

    def test_disabled_embedder_does_not_resolve_a_model(self):
        import os
        previous = os.environ.get("PERO_APP_INFRA_EMBED")
        os.environ["PERO_APP_INFRA_EMBED"] = "0"
        try:
            self.assertIsNone(model_path())
            self.assertIsNone(NullEmbedder().embed("query"))
        finally:
            if previous is None:
                os.environ.pop("PERO_APP_INFRA_EMBED")
            else:
                os.environ["PERO_APP_INFRA_EMBED"] = previous


if __name__ == "__main__":
    unittest.main()
