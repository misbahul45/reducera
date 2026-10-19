from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = next((p for p in Path(__file__).resolve().parents if (p / "scripts" / "check-ownership-rules.sh").exists()), None)
SCRIPT = (ROOT or Path("/nonexistent")) / "scripts" / "check-ownership-rules.sh"
LABEL = "reward rules, level thresholds or achievements written outside the gamify admin services and the seeder"
CLIENT = "pri" + "sma"

pytestmark = pytest.mark.skipif(ROOT is None, reason="repository scripts are not part of the image")


def run_gate(tree: dict[str, str], tmp_path: Path) -> subprocess.CompletedProcess:
    for relative, content in tree.items():
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    return subprocess.run(["bash", str(SCRIPT)], cwd=tmp_path, capture_output=True, text=True, timeout=60)


ROW_WRITES = {
    "rule-create": "await this.{c}.rewardRule.create({{ data }});",
    "rule-createmany": "await tx.rewardRule.createMany({{ data }});",
    "rule-update": "await tx.rewardRule.updateMany({{ where, data }});",
    "rule-upsert": "await tx.rewardRule.upsert({{ where, create, update }});",
    "rule-delete": "await this.{c}.rewardRule.deleteMany({{ where }});",
    "level-createmany": "await tx.levelThreshold.createMany({{ data }});",
    "level-upsert": "await tx.levelThreshold.upsert({{ where, create, update }});",
    "level-delete": "await this.{c}.levelThreshold.deleteMany();",
    "achievement-create": "await this.{c}.achievement.create({{ data }});",
    "achievement-update": "await tx.achievement.update({{ where, data }});",
    "achievement-delete": "await tx.achievement.deleteMany({{ where }});",
}


@pytest.mark.parametrize("template", ROW_WRITES.values(), ids=ROW_WRITES.keys())
def test_a_row_written_elsewhere_is_a_violation(tmp_path, template):
    statement = template.format(c=CLIENT)
    result = run_gate({"services/api/src/v1/gamify/shortcut.service.ts": f"export const x = async () => {{ {statement} }};\n"}, tmp_path)

    assert result.returncode == 1
    assert LABEL in result.stdout
    assert "services/api/src/v1/gamify/shortcut.service.ts" in result.stdout


def test_the_admin_services_the_seeder_and_specs_may_write(tmp_path):
    result = run_gate(
        {
            "services/api/src/v1/gamify/admin/rules-admin.service.ts": "await client.rewardRule.createMany({});\nawait client.rewardRule.updateMany({});\n",
            "services/api/src/v1/gamify/admin/levels-admin.service.ts": "await client.levelThreshold.deleteMany();\nawait client.levelThreshold.createMany({});\n",
            "services/api/src/v1/gamify/admin/achievements-admin.service.ts": "await client.achievement.create({});\nawait client.achievement.update({});\n",
            "services/api/src/v1/gamify/seed/gamify-seeder.ts": "await tx.rewardRule.createMany({});\nawait tx.levelThreshold.createMany({});\nawait tx.achievement.create({});\n",
            "services/api/src/v1/__tests__/x.int.spec.ts": f"await {CLIENT}.rewardRule.deleteMany({{}});\nawait {CLIENT}.achievement.deleteMany({{}});\n",
        },
        tmp_path,
    )

    assert result.returncode == 0
    assert LABEL not in result.stdout


def test_a_user_achievement_is_not_an_achievement_row(tmp_path):
    result = run_gate({"services/api/src/v1/gamify/achievements/achievement-evaluator.ts": "await tx.userAchievement.createMany({});\n"}, tmp_path)

    assert result.returncode == 0
    assert LABEL not in result.stdout


def test_reads_are_not_flagged(tmp_path):
    result = run_gate(
        {"services/api/src/v1/gamify/rewards/reward-rules.service.ts": "await tx.rewardRule.findMany();\nawait tx.levelThreshold.findMany({});\nawait tx.achievement.findMany({});\nawait tx.achievement.count({});\n"},
        tmp_path,
    )

    assert result.returncode == 0
    assert LABEL not in result.stdout
