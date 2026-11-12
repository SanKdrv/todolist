<script setup lang="ts">
import { computed } from 'vue'

import { useTasksStore } from '@/stores/tasks'
import type { Task } from '@/types/task'

const props = defineProps<{
  task: Task
}>()

const tasksStore = useTasksStore()

const isPending = computed(() => tasksStore.isTaskPending(props.task.id))
const mutationError = computed(() => tasksStore.mutationErrorFor(props.task.id))

function toggle(): void {
  if (isPending.value) {
    return
  }
  void tasksStore.toggleTask(props.task)
}

function remove(): void {
  if (isPending.value) {
    return
  }
  void tasksStore.deleteTask(props.task.id)
}
</script>

<template>
  <li
    class="task-item"
    :class="{ 'is-completed': task.is_completed, 'is-pending': isPending }"
    :aria-busy="isPending ? 'true' : undefined"
  >
    <button
      type="button"
      class="task-toggle"
      :aria-pressed="task.is_completed"
      :aria-label="
        task.is_completed
          ? `Вернуть задачу «${task.title}» в активные`
          : `Отметить задачу «${task.title}» выполненной`
      "
      :disabled="isPending"
      @click="toggle"
    >
      <span
        v-if="task.is_completed"
        aria-hidden="true"
      >✓</span>
    </button>

    <span class="task-title">{{ task.title }}</span>

    <span
      v-if="isPending"
      class="task-pending"
      role="status"
      aria-live="polite"
    >
      Сохраняем…
    </span>

    <button
      type="button"
      class="task-delete"
      :aria-label="`Удалить задачу «${task.title}»`"
      :disabled="isPending"
      @click="remove"
    >
      Удалить
    </button>

    <p
      v-if="mutationError"
      class="task-error"
      role="alert"
    >
      {{ mutationError.message }}
    </p>
  </li>
</template>
