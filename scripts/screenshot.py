import asyncio
import os
import shutil
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import bbox_visualizer as bbv
import click
import cv2
from dotenv import dotenv_values
from frozendict import frozendict
from loguru import logger
from playwright.async_api import async_playwright
from playwright.sync_api import sync_playwright


@dataclass(frozen=True)
class Config:
    USERNAME: str
    PASSWORD: str
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = (
        "<green>{time:HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>"
    )
    VIEWPORT: frozendict = frozendict(width=1920, height=1080)
    MARKUP_COLOR: str = "#5DADE2"
    MARKUP_WIDTH: int = 5


config_vars = dotenv_values(".env")
config = Config(**config_vars)
logger.remove()
logger.add(sys.stderr, level=config.LOG_LEVEL, format=config.LOG_FORMAT)


class Shot(Enum):
    APP_ACCOUNT_BAR = "app-account-bar.png"
    CHARTS_APP = "charts-app.png"
    CHART_AREA = "chart-area.png"
    TOOLBAR = "toolbar.png"
    SIDEBAR = "sidebar.png"
    EDUCATION_APP = "education-app.png"
    COMMUNITY_APP = "community-app.png"


class Url(Enum):
    CHARTS = (
        "https://app.wallstreet.io/chart/AAPL?strategies=discover"
        "&signal=1&sortColumn=stock&sortDirection=asc&workspace=doji-screener"
    )
    EDUCATION = "https://app.wallstreet.io/education-center/getting-started"
    COMMUNITY = "https://app.wallstreet.io/communities/live-stream/dashboard"
    LOGIN = "https://app.wallstreet.io/login"


CONTEXT = Path("scripts/playwright/.auth/state.json")

SCREENSHOTS_WORFLOW = Path("screenshots-workflow")
FRESH = SCREENSHOTS_WORFLOW / "fresh"
COMPLETE = SCREENSHOTS_WORFLOW / "complete"
SCREENSHOTS = Path("docs/assets/screenshots")


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
            logger.info("Auth state exists not regenerating")
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
        logger.info("Auth state stored.")
        if screenshot:
            page.screenshot(path=FRESH / "login-test.png")

    return storage


async def screenshot_charts():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=None)
        context = await browser.new_context(
            viewport=config.VIEWPORT, storage_state=CONTEXT
        )
        page = await context.new_page()
        logger.info("New browser launched for charts screenshot")
        await page.goto(Url.CHARTS.value, wait_until="networkidle")
        # Ensure everything is generally loaded.
        await page.get_by_role("button", name="Doji Screener").wait_for(state="visible")
        await page.get_by_role("button", name="TODAY", exact=True).click()
        await page.get_by_role("menuitem", name="Show All").click()
        # Somewhat brittle but mostly works. Check that A image is loaded.
        image = page.get_by_role("img", name="Agilent Technologies, Inc.")
        await image.evaluate("img => img.complete")

        # This does not work. Not sure why. Think its because app still
        # shows visible for minimized tools.
        # visible_option = page.get_by_role("button", name="Next page").is_visible()
        # if visible_option == False:
        #     page.get_by_role("button", name="Doji Screener").click()
        #     page.get_by_role("button", name="DAILY").wait_for(state="visible")
        await page.screenshot(path=FRESH / Shot.CHARTS_APP.value)
        logger.info("charts screenshot complete")
        await page.screenshot(path=FRESH / Shot.APP_ACCOUNT_BAR.value)
        logger.info("app and account bar screenshot complete")
        await page.screenshot(path=FRESH / Shot.CHART_AREA.value)
        logger.info("chart area screenshot complete")
        await page.screenshot(path=FRESH / Shot.TOOLBAR.value)
        logger.info("toolbar screenshot complete")
        await page.screenshot(path=FRESH / Shot.SIDEBAR.value)
        logger.info("sidebar screenshot complete")


async def screenshot_education():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=None)
        context = await browser.new_context(
            viewport=config.VIEWPORT, storage_state=CONTEXT
        )
        page = await context.new_page()
        logger.info("New browser launched for education screenshot")
        await page.goto(Url.EDUCATION.value, wait_until="networkidle")
        # Ensure everything is generally loaded.
        await page.get_by_text("play_lesson Getting Started").wait_for(state="visible")
        # Fix this
        # page.locator("iframe[title=\"WallStreet.io 4.0 - Introduction\"]").content_frame.get_by_role("link", name="WallStreet IO")
        await page.screenshot(path=FRESH / Shot.EDUCATION_APP.value)
        logger.info("education screenshot complete")


async def screenshot_community():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=None)
        context = await browser.new_context(
            viewport=config.VIEWPORT, storage_state=CONTEXT
        )
        page = await context.new_page()
        logger.info("New browser launched for community screenshot")
        await page.goto(Url.COMMUNITY.value, wait_until="networkidle")
        await page.get_by_role("link", name="Dashboard").wait_for(state="visible")
        await page.screenshot(path=FRESH / Shot.COMMUNITY_APP.value)
        logger.info("community screenshot complete")


async def take_all_async():
    await asyncio.gather(
        screenshot_community(), screenshot_education(), screenshot_charts()
    )


@screenshot.command()
def take_all():
    """Take all apps screenshots using Playwright."""

    login(check_only=True)
    asyncio.run(take_all_async())


def norm_bbox(img, x1, y1, x2, y2):
    """Normalized bounding box so image size won't matter just ratio"""
    height, width = img.shape[:2]
    bbox = (int(width * x1), int(height * y1), int(width * x2), int(height * y2))
    return bbox


def add_cv2_label(img, text, bbox, side="below", gap=0, connector=False):
    """Black text on a white box, placed on a side of a bbox."""
    x1, y1, x2, y2 = bbox
    font = cv2.FONT_HERSHEY_SIMPLEX
    size = 1
    thickness = 2
    padding = 8
    (text_w, text_h), _baseline = cv2.getTextSize(text, font, size, thickness)
    box_w = text_w + 2 * padding
    box_h = text_h + 2 * padding
    center_x = (x1 + x2) // 2
    center_y = (y1 + y2) // 2
    if side == "below":
        label_x1 = center_x - box_w // 2
        label_y1 = y2 + gap
    elif side == "above":
        label_x1 = center_x - box_w // 2
        label_y1 = y1 - box_h - gap
    elif side == "left":
        label_x1 = x1 - box_w - gap
        label_y1 = center_y - box_h // 2
    elif side == "right":
        label_x1 = x2 + gap
        label_y1 = center_y - box_h // 2
    else:
        raise ValueError(f"side must be below, above, left, or right, not {side!r}")
    label_x2 = label_x1 + box_w
    label_y2 = label_y1 + box_h
    if connector:
        line_color = (255, 255, 255)
        if side == "below":
            cv2.line(img, (center_x, y2), (center_x, label_y1), line_color, 1)
        elif side == "above":
            cv2.line(img, (center_x, label_y2), (center_x, y1), line_color, 1)
        elif side == "left":
            cv2.line(img, (x1, center_y), (label_x2, center_y), line_color, 1)
        elif side == "right":
            cv2.line(img, (x2, center_y), (label_x1, center_y), line_color, 1)
    cv2.rectangle(img, (label_x1, label_y1), (label_x2, label_y2), (255, 255, 255), -1)
    text_x = label_x1 + (box_w - text_w) // 2
    text_y = label_y1 + (box_h + text_h) // 2
    cv2.putText(img, text, (text_x, text_y), font, size, (0, 0, 0), thickness)
    return img


def markup_app_account_bar():
    """Markup and save app and account screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.APP_ACCOUNT_BAR.value)
    # App and Account Bar
    app_account = norm_bbox(img, 0, 0, 0.036, 1.0)
    img = bbv.draw_box(img, app_account)
    gap = int(0.03 * img.shape[0])
    img = add_cv2_label(
        img, "App and Account Bar", app_account, side="right", gap=gap, connector=True
    )
    # Live Stream
    live_stream = norm_bbox(img, 0.92, 0.0, 1.0, 0.056)
    img = bbv.draw_box(img, live_stream)
    gap = int(0.04 * img.shape[0])
    img = add_cv2_label(
        img, "Live Stream", live_stream, side="left", gap=gap, connector=True
    )
    cv2.imwrite(COMPLETE / Shot.APP_ACCOUNT_BAR.value, img)


def markup_charts():
    """Markup and save charts screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.CHARTS_APP.value)
    chart_area = norm_bbox(img, 0.035, 0.0, 0.79, 0.63)
    img = bbv.draw_box(img, chart_area)
    img = bbv.add_label(img, "Chart Area", chart_area)
    toolbar = norm_bbox(img, 0.035, 0.63, 0.79, 1.0)
    img = bbv.draw_box(img, toolbar)
    img = bbv.add_label(img, "Toolbar", toolbar, top=False)
    sidebar = norm_bbox(img, 0.79, 0, 1.0, 1.0)
    img = bbv.draw_box(img, sidebar)
    img = bbv.add_label(img, "Sidebar", sidebar)
    cv2.imwrite(COMPLETE / Shot.CHARTS_APP.value, img)


def markup_chart_area():
    """Markup and save chart area screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.CHART_AREA.value)
    # Stock Search
    stock_search = norm_bbox(img, 0.1, 0, 0.16, 0.06)
    img = bbv.draw_box(img, stock_search)
    gap = int(0.05 * img.shape[1])
    img = add_cv2_label(img, "Stock Search", stock_search, gap=gap, connector=True)
    # Charting Tools
    charting_tools = norm_bbox(img, 0.1, 0.0, 0.405, 0.06)
    img = bbv.draw_box(img, charting_tools)
    img = add_cv2_label(img, "Charting Tools", charting_tools)
    # Plot (candlestick chart, below header and above time-range selector)
    plot = norm_bbox(img, 0.035, 0.06, 0.79, 0.63)
    img = bbv.draw_box(img, plot)
    img = bbv.add_label(img, "Plot", plot)
    cv2.imwrite(COMPLETE / Shot.CHART_AREA.value, img)


def markup_toolbar():
    """Markup and save toolbar screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.TOOLBAR.value)
    filter_area = norm_bbox(img, 0.035, 0.63, 0.79, 0.718)
    img = bbv.draw_box(img, filter_area)
    img = bbv.add_label(img, "Filter Area", filter_area, top=False)
    data_area = norm_bbox(img, 0.035, 0.718, 0.79, 1.0)
    img = bbv.draw_box(img, data_area)
    img = bbv.add_label(img, "Data Area", data_area, top=False)
    cv2.imwrite(COMPLETE / Shot.TOOLBAR.value, img)


def markup_sidebar():
    """Markup and save sidebar screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.SIDEBAR.value)
    sidebar_widgets = norm_bbox(img, 0.79, 0.055, 1.0, 0.11)
    img = bbv.draw_box(img, sidebar_widgets)
    img = bbv.add_label(img, "Sidebar Widgets", sidebar_widgets, top=True)
    sidebar_display = norm_bbox(img, 0.79, 0.11, 1.0, 1.0)
    img = bbv.draw_box(img, sidebar_display)
    img = bbv.add_label(img, "Sidebar Display Area", sidebar_display, top=False)
    cv2.imwrite(COMPLETE / Shot.SIDEBAR.value, img)


def markup_education():
    """Markup and save education app screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.EDUCATION_APP.value)
    education_bar = norm_bbox(img, 0.035, 0, 1.0, 0.06)
    img = bbv.draw_box(img, education_bar)
    gap = int(0.03 * img.shape[1])
    img = add_cv2_label(img, "Education Bar", education_bar, gap=gap, connector=True)
    education_area = norm_bbox(img, 0.035, 0.06, 1.0, 1.0)
    img = bbv.draw_box(img, education_area)
    img = bbv.add_label(img, "Education Area", education_area, top=False)
    cv2.imwrite(COMPLETE / Shot.EDUCATION_APP.value, img)


def markup_community():
    """Markup and save community app screenshot to complete directory."""
    img = cv2.imread(FRESH / Shot.COMMUNITY_APP.value)
    community_bar = norm_bbox(img, 0.035, 0, 1.0, 0.06)
    img = bbv.draw_box(img, community_bar)
    gap = int(0.01 * img.shape[1])
    img = add_cv2_label(img, "Community Bar", community_bar, gap=gap, connector=True)
    community_area = norm_bbox(img, 0.035, 0.06, 1.0, 1.0)
    img = bbv.draw_box(img, community_area)
    img = bbv.add_label(img, "Community Area", community_area, top=False)
    cv2.imwrite(COMPLETE / Shot.COMMUNITY_APP.value, img)


@screenshot.command()
def markup_all():
    """Add bounding boxes and labels to screenshots."""
    markup_app_account_bar()
    markup_charts()
    markup_chart_area()
    markup_toolbar()
    markup_sidebar()
    markup_education()
    markup_community()


def move_app_account_bar():
    """Copy charts app screenshot to screenshots directory."""
    source = COMPLETE / Shot.APP_ACCOUNT_BAR.value
    dest = SCREENSHOTS / Shot.APP_ACCOUNT_BAR.value
    shutil.copy2(source, dest)


def move_charts():
    """Copy charts app screenshot to screenshots directory."""
    source = COMPLETE / Shot.CHARTS_APP.value
    dest = SCREENSHOTS / Shot.CHARTS_APP.value
    shutil.copy2(source, dest)


def move_education():
    """Copy education app screenshot to screenshots directory."""
    source = COMPLETE / Shot.EDUCATION_APP.value
    dest = SCREENSHOTS / Shot.EDUCATION_APP.value
    shutil.copy2(source, dest)


def move_community():
    """Copy community app screenshot to screenshots directory."""
    source = COMPLETE / Shot.COMMUNITY_APP.value
    dest = SCREENSHOTS / Shot.COMMUNITY_APP.value
    shutil.copy2(source, dest)


@screenshot.command()
def move_all():
    """Replace docs screenshots with screenshots from complete"""
    shots = [
        Shot.APP_ACCOUNT_BAR,
        Shot.CHARTS_APP,
        Shot.CHART_AREA,
        Shot.TOOLBAR,
        Shot.SIDEBAR,
        Shot.EDUCATION_APP,
        Shot.COMMUNITY_APP,
    ]
    for one_shot in shots:
        source = COMPLETE / one_shot.value
        dest = SCREENSHOTS / one_shot.value
        shutil.copy2(source, dest)


if __name__ == "__main__":
    screenshot()
