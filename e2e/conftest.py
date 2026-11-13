"""Fixtures for TaskFlow Selenium E2E tests."""

import os
from collections.abc import Iterator

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.remote.webdriver import WebDriver

from task_list_page import TaskListPage

BASE_URL = os.getenv("E2E_BASE_URL", "http://web:8080")
SELENIUM_REMOTE_URL = os.getenv("SELENIUM_REMOTE_URL", "http://localhost:4444/wd/hub")


@pytest.fixture()
def driver() -> Iterator[WebDriver]:
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1280,800")

    browser = webdriver.Remote(command_executor=SELENIUM_REMOTE_URL, options=options)
    browser.set_page_load_timeout(30)
    browser.implicitly_wait(0)
    try:
        yield browser
    finally:
        browser.quit()


@pytest.fixture()
def task_page(driver: WebDriver) -> TaskListPage:
    page = TaskListPage(driver, BASE_URL)
    page.open()
    return page
