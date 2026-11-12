<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

import { useTasksStore } from '@/stores/tasks'

const tasksStore = useTasksStore()
const { items, total, loading, error, isEmpty, isFiltered } = storeToRefs(tasksStore)

onMounted(() => {
  void tasksStore.fetchTasks()
})

function retry(): void {
  void tasksStore.fetchTasks()
}
</script>

<template>
  <section
    class="page"
    aria-labelledby="tasks-title"
  >
    <div class="tasks-header">
      <h1
        id="tasks-title"
        class="page-title"
      >
        Мои задачи
      </h1>
      <p
        v-if="!loading && !error && !isEmpty"
        class="task-count"
      >
        Всего задач: {{ total }}
      </p>
    </div>

    <div
      v-if="loading"
      class="status-block"
      role="status"
      aria-live="polite"
    >
      <span
        class="status-spinner"
        aria-hidden="true"
      />
      <p>Загрузка задач…</p>
    </div>

    <div
      v-else-if="error"
      class="status-block status-error"
      role="alert"
    >
      <p class="status-title">
        Не удалось загрузить задачи
      </p>
      <p class="status-message">
        {{ error.message }}
      </p>
      <button
        type="button"
        class="retry-button"
        @click="retry"
      >
        Повторить
      </button>
    </div>

    <div
      v-else-if="isEmpty"
      class="status-block"
    >
      <p class="status-title">
        {{ isFiltered ? 'По выбранному фильтру задач нет' : 'Пока нет задач' }}
      </p>
      <p class="status-message">
        {{
          isFiltered
            ? 'Попробуйте изменить фильтр или сбросить его.'
            : 'Здесь появятся ваши задачи.'
        }}
      </p>
    </div>

    <ul
      v-else
      class="task-list"
    >
      <li
        v-for="task in items"
        :key="task.id"
        class="task-item"
        :class="{ 'is-completed': task.is_completed }"
      >
        <span
          class="task-dot"
          aria-hidden="true"
        />
        <span class="task-title">{{ task.title }}</span>
        <span class="visually-hidden">
          {{ task.is_completed ? 'Выполнена' : 'Активна' }}
        </span>
      </li>
    </ul>
  </section>
</template>
