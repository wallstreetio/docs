from dataclasses import dataclass
from enum import Enum
import os
from pathlib import Path

import click
from dotenv import dotenv_values
from playwright.sync_api import sync_playwright


@dataclass(frozen=True)
class Config:
    USERNAME: str
    PASSWORD: str


config_vars = dotenv_values(".env")
config = Config(**config_vars)


class Image(Enum):
    APP_ACCOUNT_BAR = "app-account-bar.png"
    CHARTS_APP = "charts-app.png"
    COMMUNITY_APP = "community-app.png"
    EDUCATION_APP = "education-app.png"


class Url(Enum):
    BASE = (
        "https://app.wallstreet.io/chart/AAPL?strategies=discover"
        "&signal=1&sortColumn=stock&sortDirection=asc&workspace=doji-screener"
    )
    LOGIN = "https://app.wallstreet.io/login"


CONTEXT = Path("scripts/playwright/.auth/state.json")


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

    # async with async_playwright() as p:
    #     pass

    size = os.path.getsize(file_path)
    click.echo(f"Saved: {file_path} ({size / 1024:.1f} KB)")


def login(check_only=False, auth=None, screenshot=False):
    """Login. Save context state."""
    if auth is None:
        auth = CONTEXT
    if check_only:
        state_exists = auth.is_file()
        if state_exists:
            return

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        page.goto(Url.LOGIN.value, wait_until="networkidle")

        page.get_by_label("Username or Email").fill(config.USERNAME)
        page.get_by_role("button", name="Next").click()
        page.get_by_role("textbox", name="Password").fill(config.PASSWORD)
        page.get_by_role("button", name="Login").click()

        page.locator("a").filter(has_text="Charts").click()
        page.get_by_role("button", name="Doji Screener").click()
        # Wait for page to blur to clear.
        # long_cell = page.get_by_role("cell", name="Long").first
        # long_cell.wait_for(state="visible")
        storage = context.storage_state(path=auth)
        if screenshot:
            page.screenshot(path=Path("screenshots-workflow/fresh") / "login-test.png")

    return storage


def screenshot_charts():

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        page.get_by_role("button", name="Doji Screener").click()


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
    # path = Path(path)
    # file_path = path / f"{name}.png"

    storage = login(screenshot=True)
    return storage

    # with sync_playwright() as p:
    #     browser = p.chromium.launch()
    #     page = browser.new_page(viewport={"width": width, "height": height})

    #     click.echo(f"Loading {url}...")
    #     page.goto(url, wait_until="networkidle")

    #     page.get_by_label("Username or Email").fill(config.USERNAME)
    #     page.get_by_role("button", name="Next").click()
    #     page.get_by_role("textbox", name="Password").fill(config.PASSWORD)
    #     page.get_by_role("button", name="Login").click()

    #     page.locator("a").filter(has_text="Charts").click()
    #     # Wait for page to blur to clear.
    #     long_cell = page.get_by_role("cell", name="Long").first
    #     long_cell.wait_for(state="visible")
    #     page.screenshot(path=file_path, full_page=full_page)
    #     browser.close()

    # size = os.path.getsize(file_path)
    # click.echo(f"Saved: {file_path} ({size / 1024:.1f} KB)")


if __name__ == "__main__":
    screenshot()
