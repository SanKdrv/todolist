"""Page object for the TaskFlow task list."""

from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


class TaskListPage:
    FORM = (By.CSS_SELECTOR, ".task-form")
    TITLE_INPUT = (By.ID, "task-title")
    DESCRIPTION_INPUT = (By.ID, "task-description")
    SUBMIT_BUTTON = (By.CSS_SELECTOR, ".submit-button")
    TASK_ITEM = (By.CSS_SELECTOR, ".task-item")
    TASK_TITLE = (By.CSS_SELECTOR, ".task-title")
    TASK_DESCRIPTION = (By.CSS_SELECTOR, ".task-description")
    TASK_TOGGLE = (By.CSS_SELECTOR, ".task-toggle")
    TASK_DELETE = (By.CSS_SELECTOR, ".task-delete")
    FILTER_BUTTON = (By.CSS_SELECTOR, ".filter-button")
    STATUS_BLOCK = (By.CSS_SELECTOR, ".status-block")

    def __init__(self, driver: WebDriver, base_url: str, timeout: int = 10) -> None:
        self.driver = driver
        self.base_url = base_url.rstrip("/")
        self.wait = WebDriverWait(driver, timeout, poll_frequency=0.2)

    def open(self) -> None:
        self.driver.get(f"{self.base_url}/")
        self.wait_for_ready()

    def refresh(self) -> None:
        self.driver.refresh()
        self.wait_for_ready()

    def wait_for_ready(self) -> None:
        self.wait.until(EC.visibility_of_element_located(self.TITLE_INPUT))
        self.wait.until(EC.visibility_of_element_located(self.FORM))

    def create_task(self, title: str, description: str | None = None) -> None:
        title_input = self.wait.until(EC.element_to_be_clickable(self.TITLE_INPUT))
        title_input.clear()
        title_input.send_keys(title)

        if description is not None:
            description_input = self.wait.until(EC.element_to_be_clickable(self.DESCRIPTION_INPUT))
            description_input.clear()
            description_input.send_keys(description)

        self.wait.until(EC.element_to_be_clickable(self.SUBMIT_BUTTON)).click()
        self.wait_for_task(title)

        self.wait.until(
            lambda _: self.driver.find_element(*self.TITLE_INPUT).get_attribute("value") == ""
        )
        if description is not None:
            self.wait.until(
                lambda _: self.driver.find_element(*self.DESCRIPTION_INPUT).get_attribute("value") == ""
            )

    def _task_titles(self) -> list[str]:
        try:
            return [element.text for element in self.driver.find_elements(*self.TASK_TITLE)]
        except StaleElementReferenceException:
            return []

    def _find_task(self, title: str):
        try:
            for item in self.driver.find_elements(*self.TASK_ITEM):
                titles = item.find_elements(*self.TASK_TITLE)
                if titles and titles[0].text == title:
                    return item
        except StaleElementReferenceException:
            return None
        return None

    def task_by_title(self, title: str):
        return self._find_task(title)

    def wait_for_task(self, title: str):
        return self.wait.until(lambda _: self._find_task(title))

    def wait_for_tasks(self, present=(), absent=()) -> None:
        expected_present = tuple(present)
        expected_absent = tuple(absent)

        def condition(_) -> bool:
            titles = self._task_titles()
            return all(title in titles for title in expected_present) and all(
                title not in titles for title in expected_absent
            )

        self.wait.until(condition)

    def _description_state(self, title: str):
        try:
            for item in self.driver.find_elements(*self.TASK_ITEM):
                titles = item.find_elements(*self.TASK_TITLE)
                if titles and titles[0].text == title:
                    descriptions = item.find_elements(*self.TASK_DESCRIPTION)
                    return (True, descriptions[0].text if descriptions else None)
        except StaleElementReferenceException:
            return None
        return (False, None)

    def task_description(self, title: str) -> str | None:
        state = self.wait.until(lambda _: self._description_state(title))
        return state[1]

    def wait_for_task_description(self, title: str) -> str:
        description = self.wait.until(lambda _: self.task_description(title))
        assert description is not None
        return description

    def toggle_task(self, title: str) -> None:
        item = self.wait_for_task(title)
        item.find_element(*self.TASK_TOGGLE).click()
        self.wait.until(lambda _: self.is_completed(title))

    def _completion_state(self, title: str):
        try:
            for item in self.driver.find_elements(*self.TASK_ITEM):
                titles = item.find_elements(*self.TASK_TITLE)
                if titles and titles[0].text == title:
                    toggle = item.find_element(*self.TASK_TOGGLE)
                    classes = (item.get_attribute("class") or "").split()
                    return (
                        True,
                        toggle.get_attribute("aria-pressed") == "true"
                        and "is-completed" in classes,
                    )
        except StaleElementReferenceException:
            return None
        return (False, False)

    def is_completed(self, title: str) -> bool:
        state = self.wait.until(lambda _: self._completion_state(title))
        return state[1]

    def delete_task(self, title: str) -> None:
        item = self.wait_for_task(title)
        item.find_element(*self.TASK_DELETE).click()
        self.wait.until(lambda _: self.task_by_title(title) is None)

    def filter_by(self, label: str) -> None:
        def find_button(_):
            for button in self.driver.find_elements(*self.FILTER_BUTTON):
                if button.text.strip() == label:
                    return button
            return False

        button = self.wait.until(find_button)
        button.click()
        self.wait.until(lambda _: self._filter_is_active(label))

    def _filter_is_active(self, label: str) -> bool:
        try:
            for button in self.driver.find_elements(*self.FILTER_BUTTON):
                if button.text.strip() == label:
                    return button.get_attribute("aria-pressed") == "true"
        except StaleElementReferenceException:
            return False
        return False

    def wait_for_empty_state(self) -> None:
        self.wait.until(
            lambda _: any(
                "Пока нет задач" in block.text
                for block in self.driver.find_elements(*self.STATUS_BLOCK)
            )
        )
