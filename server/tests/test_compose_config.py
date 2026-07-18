from pathlib import Path


def test_readme_explicitly_loads_root_environment_file():
    readme = (Path(__file__).parents[2] / "README.md").read_text()

    assert "docker compose --env-file .env -f deploy/docker-compose.yml up --build" in readme
