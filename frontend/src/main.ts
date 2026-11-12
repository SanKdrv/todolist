import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import type { ApiError } from './api/client'
import router from './router'
import { useSessionStore } from './stores/session'
import './assets/main.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

const sessionStore = useSessionStore(pinia)

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) {
    element.textContent = text
  }
  return element
}

/**
 * Plain-DOM boot screen.
 *
 * Vue is mounted only after the session is ready, so the boot screen has to
 * exist outside the app. Text is assigned via `textContent`, so a server error
 * message can never inject markup.
 */
function renderLoading(root: HTMLElement): void {
  const screen = createElement('div', 'boot-screen')
  screen.setAttribute('role', 'status')
  screen.setAttribute('aria-live', 'polite')

  const card = createElement('div', 'boot-card')
  const spinner = createElement('div', 'boot-spinner')
  spinner.setAttribute('aria-hidden', 'true')

  card.append(spinner, createElement('p', 'boot-title', 'Загрузка TaskFlow…'))
  screen.append(card)
  root.replaceChildren(screen)
}

function renderError(
  root: HTMLElement,
  error: ApiError | null,
  onRetry: () => void,
): void {
  const screen = createElement('div', 'boot-screen')
  screen.setAttribute('role', 'alert')

  const card = createElement('div', 'boot-card boot-error')
  card.append(
    createElement('h1', 'boot-title', 'Не удалось подключиться'),
    createElement(
      'p',
      'boot-message',
      'Не удалось инициализировать сессию. Проверьте, что backend запущен, и повторите попытку.',
    ),
  )

  if (error !== null) {
    card.append(createElement('p', 'boot-error-detail', error.message))
  }

  const button = createElement('button', 'boot-retry', 'Повторить')
  button.type = 'button'
  button.addEventListener('click', () => {
    button.disabled = true
    onRetry()
  })
  card.append(button)

  screen.append(card)
  root.replaceChildren(screen)
}

/**
 * Wait for the session before mounting the app.
 *
 * A retry re-enters this function; the app instance is mounted at most once
 * and only after the store reports `isReady`.
 */
export async function startApplication(root: HTMLElement): Promise<void> {
  renderLoading(root)
  await sessionStore.bootstrap()

  if (sessionStore.isReady) {
    root.replaceChildren()
    app.mount(root)
    return
  }

  renderError(root, sessionStore.error, () => {
    void startApplication(root)
  })
}

const root = document.querySelector<HTMLDivElement>('#app')
if (root !== null) {
  void startApplication(root)
}
