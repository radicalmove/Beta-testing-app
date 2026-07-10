from html.parser import HTMLParser
from pathlib import Path

from app.models import Comment, CommentStatus, UserRole
from test_dashboard import dashboard_client, login, seed


class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []
        self.text = ""

    def descendants(self):
        yield self
        for child in self.children:
            yield from child.descendants()

    def content(self):
        return (self.text + " ".join(child.content() for child in self.children)).strip()


class Document(HTMLParser):
    void = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.root = Node("document", [])
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.void:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].text += data

    @property
    def nodes(self):
        return list(self.root.descendants())[1:]


def parse(html):
    document = Document()
    document.feed(html)
    return document


def accessible_name(node, ids, labels):
    if node.attrs.get("aria-label"):
        return node.attrs["aria-label"].strip()
    if labelledby := node.attrs.get("aria-labelledby"):
        return " ".join(ids[item].content() for item in labelledby.split() if item in ids).strip()
    if node.attrs.get("id") in labels:
        return labels[node.attrs["id"]].content()
    parent = node.parent
    while parent:
        if parent.tag == "label":
            return parent.content()
        parent = parent.parent
    return node.content()


def assert_accessible_document(html):
    document = parse(html)
    nodes = document.nodes
    id_nodes = [node for node in nodes if node.attrs.get("id")]
    ids = {node.attrs["id"]: node for node in id_nodes}
    assert len(ids) == len(id_nodes), "IDs must be unique"
    labels = {node.attrs["for"]: node for node in nodes if node.tag == "label" and node.attrs.get("for")}
    for target in labels:
        assert target in ids, f"label target #{target} is missing"
    for node in nodes:
        if node.tag in {"button", "a", "select", "textarea"}:
            assert accessible_name(node, ids, labels), f"unnamed <{node.tag}>"
    assert any(node.tag == "main" for node in nodes)
    assert any(node.tag == "h1" for node in nodes)
    skip = next(node for node in nodes if node.tag == "a" and "skip-link" in node.attrs.get("class", ""))
    target = skip.attrs["href"].removeprefix("#")
    assert target in ids and nodes.index(skip) < nodes.index(ids[target])
    return document


def test_rendered_dashboard_and_thread_have_structural_accessibility_contract(dashboard_client):
    comment_id, _ = seed(dashboard_client)
    login(dashboard_client, "lead-a11y@example.test", UserRole.LD_DCD)
    index = dashboard_client.get("/dashboard").text
    thread = dashboard_client.get(f"/dashboard/threads/{comment_id}?share_error=invalid_recipient").text

    index_doc = assert_accessible_document(index)
    thread_doc = assert_accessible_document(thread)
    assert any(node.attrs.get("aria-live") == "polite" for node in index_doc.nodes)
    alerts = [node for node in thread_doc.nodes if node.attrs.get("role") == "alert"]
    assert alerts and all(node.attrs.get("aria-live") == "assertive" for node in alerts)
    status = next(node for node in thread_doc.nodes if node.attrs.get("id") == "status")
    assert status.attrs.get("aria-describedby")
    placeholder = next(node for node in status.children if "selected" in node.attrs)
    assert placeholder.attrs.get("value") == "" and "disabled" in placeholder.attrs


def test_terminal_status_controls_are_disabled_and_keyboard_focus_contract_is_explicit(dashboard_client):
    comment_id, _ = seed(dashboard_client)
    db = dashboard_client.db_factory()
    db.get(Comment, comment_id).status = CommentStatus.RESOLVED
    db.commit()
    login(dashboard_client, "lead-terminal-a11y@example.test", UserRole.LD_DCD)
    document = assert_accessible_document(dashboard_client.get(f"/dashboard/threads/{comment_id}").text)
    status = next(node for node in document.nodes if node.attrs.get("id") == "status")
    status_form = status.parent
    while status_form.tag != "form":
        status_form = status_form.parent
    assert "disabled" in status.attrs and status.attrs.get("aria-disabled") == "true"
    button = next(node for node in status_form.descendants() if node.tag == "button")
    assert "disabled" in button.attrs and button.attrs.get("aria-disabled") == "true"
    assert not any(int(node.attrs.get("tabindex", "0")) > 0 for node in document.nodes)

    css = (Path(__file__).parents[1] / "app/static/app.css").read_text()
    assert ":focus-visible" in css and "outline:" in css


def test_playwright_keyboard_smoke_is_deferred_to_extension_end_to_end_phase():
    plan = (Path(__file__).parents[2] / "docs/superpowers/plans/2026-07-10-moodle-course-review.md").read_text()
    assert "Deferred Task 7 keyboard verification" in plan
    assert "Playwright" in plan and "keyboard" in plan
