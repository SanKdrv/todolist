<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

import TaskForm from '@/components/TaskForm.vue'
import TaskItem from '@/components/TaskItem.vue'
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
        v-if="items.length > 0"
        class="task-count"
      >
        Всего задач: {{ total }}
      </p>
    </div>

    <TaskForm />

    <div
      v-if="loading && items.length === 0"
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
      v-else-if="error && items.length === 0"
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

    <div v-else>
      <div
        v-if="loading"
        class="status-inline"
        role="status"
        aria-live="polite"
      >
        <span
          class="status-spinner status-spinner-small"
          aria-hidden="true"
        />
        <p>Обновляем список…</p>
      </div>

      <div
        v-if="error"
        class="status-block status-error status-inline"
        role="alert"
      >
        <div class="status-inline-text">
          <p class="status-title">
            Не удалось обновить список
          </p>
          <p class="status-message">
            {{ error.message }}
          </p>
        </div>
        <button
          type="button"
          class="retry-button"
          @click="retry"
        >
          Повторить
        </button>
      </div>

      <div
        v-if="isEmpty"
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
        <TaskItem
          v-for="task in items"
          :key="task.id"
          :task="task"
        />
      </ul>
    </div>
  </section>
</template>
