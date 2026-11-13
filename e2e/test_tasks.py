"""Selenium E2E scenarios for TaskFlow."""

from uuid import uuid4

from task_list_page import TaskListPage


def unique(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:10]}"


def test_app_opens_and_form_is_available(task_page: TaskListPage) -> None:
    assert "TaskFlow" in task_page.driver.title
    assert task_page.driver.find_element(*TaskListPage.FORM).is_displayed()
    assert task_page.driver.find_element(*TaskListPage.TITLE_INPUT).is_displayed()
    assert task_page.driver.find_element(*TaskListPage.DESCRIPTION_INPUT).is_displayed()
    assert task_page.driver.find_element(*TaskListPage.SUBMIT_BUTTON).is_enabled()


def test_create_task_with_title_and_description(task_page: TaskListPage) -> None:
    title = unique("e2e-create")
    description = unique("e2e-description")

    task_page.create_task(title, description)

    assert task_page.driver.find_element(*TaskListPage.TITLE_INPUT).get_attribute("value") == ""
    assert task_page.driver.find_element(*TaskListPage.DESCRIPTION_INPUT).get_attribute("value") == ""
    assert task_page.task_by_title(title) is not None


def test_task_title_and_description_are_rendered(task_page: TaskListPage) -> None:
    title = unique("e2e-render")
    description = unique("e2e-description")

    task_page.create_task(title, description)

    assert task_page.task_by_title(title) is not None
    assert task_page.wait_for_task_description(title) == description


def test_mark_task_completed(task_page: TaskListPage) -> None:
    title = unique("e2e-complete")
    description = unique("e2e-description")

    task_page.create_task(title, description)
    task_page.toggle_task(title)

    assert task_page.is_completed(title)
    assert task_page.task_description(title) == description


def test_filters_show_correct_tasks(task_page: TaskListPage) -> None:
    active_title = unique("e2e-filter-active")
    completed_title = unique("e2e-filter-completed")

    task_page.create_task(active_title)
    task_page.create_task(completed_title)
    task_page.toggle_task(completed_title)

    task_page.filter_by("Активные")
    task_page.wait_for_tasks(present=[active_title], absent=[completed_title])

    task_page.filter_by("Завершённые")
    task_page.wait_for_tasks(present=[completed_title], absent=[active_title])

    task_page.filter_by("Все")
    task_page.wait_for_tasks(present=[active_title, completed_title])


def test_delete_task(task_page: TaskListPage) -> None:
    title = unique("e2e-delete")

    task_page.create_task(title)
    task_page.delete_task(title)

    assert task_page.task_by_title(title) is None
    task_page.wait_for_empty_state()


def test_task_persists_after_reload(task_page: TaskListPage) -> None:
    title = unique("e2e-reload")
    description = unique("e2e-description")

    task_page.create_task(title, description)
    task_page.refresh()

    task_page.wait_for_tasks(present=[title])
    assert task_page.task_description(title) == description
