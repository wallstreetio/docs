import os
from pathlib import Path

import click
from playwright.async_api import async_playwright
from playwright.sync_api import sync_playwright


@click.group()
def screenshot():
    pass


@screenshot.command()
@click.argument("url")
@click.option(
    "--path",
    "-p",
    default="screenshots-workflow/fresh",
    help="Output file path (default: screenshot_TIMESTAMP.png)",
)
@click.option("--name", default="screenshot")
@click.option(
    "--full-page",
    "-f",
    is_flag=True,
    default=False,
    help="Capture the full scrollable page",
)
@click.option("--width", "-w", default=1280, help="Viewport width (default: 1280)")
@click.option("--height", "-h", default=720, help="Viewport height (default: 720)")
def single(url, path, name, full_page, width, height):
    """Take a screenshot of a URL using Playwright."""
    path = Path(path)
    file_path = path / f"{name}.png"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})

        click.echo(f"Loading {url}...")
        page.goto(url, wait_until="networkidle")

        page.screenshot(path=file_path, full_page=full_page)
        browser.close()

    with async_playwright() as p:
        pass

    size = os.path.getsize(file_path)
    click.echo(f"Saved: {file_path} ({size / 1024:.1f} KB)")


def log_in(check_only=False, auth_dir="scripts/playwright/.auth"):
    """Login. Save context state."""
    auth_dir = Path(auth_dir)
    if check_only:
        state_exists = (auth_dir / "state.json").is_file()
        if state_exists:
            pass
    else:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()

            page.goto("https://app.wallstreet.io/login", wait_until="networkidle")

            page.get_by_label("Username or Email").fill("")
            page.get_by_role("button", name="Next").click()
            page.get_by_role("textbox", name="Password").fill("")
            page.get_by_role("button", name="Login").click()

            page.locator("a").filter(has_text="Charts").click()
            # Wait for page to blur to clear.
            long_cell = page.get_by_role("cell", name="Long").first
            long_cell.wait_for(state="visible")
            # page.screenshot(path=file_path, full_page=full_page)
    # use sync playwright to r


@screenshot.command()
@click.option("--url", default="https://app.wallstreet.io/login")
@click.option(
    "--path",
    "-p",
    default="screenshots-workflow/fresh",
    help="Output file path (default: screenshot_TIMESTAMP.png)",
)
@click.option("--name", default="screenshot")
@click.option(
    "--full-page",
    "-f",
    is_flag=True,
    default=False,
    help="Capture the full scrollable page",
)
@click.option("--width", "-w", default=1280, help="Viewport width (default: 1280)")
@click.option("--height", "-h", default=720, help="Viewport height (default: 720)")
def auth_single(url, path, name, full_page, width, height):
    """Take a screenshot of a URL using Playwright."""
    path = Path(path)
    file_path = path / f"{name}.png"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})

        click.echo(f"Loading {url}...")
        page.goto(url, wait_until="networkidle")

        page.get_by_label("Username or Email").fill("")
        page.get_by_role("button", name="Next").click()
        page.get_by_role("textbox", name="Password").fill("")
        page.get_by_role("button", name="Login").click()

        page.locator("a").filter(has_text="Charts").click()
        # Wait for page to blur to clear.
        long_cell = page.get_by_role("cell", name="Long").first
        long_cell.wait_for(state="visible")
        page.screenshot(path=file_path, full_page=full_page)
        browser.close()

    size = os.path.getsize(file_path)
    click.echo(f"Saved: {file_path} ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    screenshot()
