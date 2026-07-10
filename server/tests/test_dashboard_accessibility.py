from pathlib import Path


def test_dashboard_templates_have_named_landmarks_labels_and_live_status():
    root = Path(__file__).parents[1] / "app"
    index = (root / "templates/dashboard/index.html").read_text()
    thread = (root / "templates/dashboard/thread.html").read_text()
    css = (root / "static/app.css").read_text()
    assert '<main id="main-content"' in index and '<form aria-label="Filter feedback"' in index
    assert 'aria-live="polite"' in index and 'aria-label="Unread feedback only"' in index
    assert '<article aria-labelledby="thread-title"' in thread
    assert '<label for="reply-body">' in thread and '<textarea id="reply-body"' in thread
    assert ':focus-visible' in css and 'outline:' in css
