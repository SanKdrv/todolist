<script setup lang="ts">
import { ref } from 'vue'

import { useTasksStore } from '@/stores/tasks'

const TITLE_MAX_LENGTH = 200

const tasksStore = useTasksStore()

const title = ref('')
const description = ref('')
const validationError = ref('')
const apiError = ref('')
const submitting = ref(false)

function clearValidationError(): void {
  validationError.value = ''
}

async function submit(): Promise<void> {
  if (submitting.value) {
    return
  }

  apiError.value = ''
  const trimmedTitle = title.value.trim()

  if (trimmedTitle.length === 0) {
    validationError.value = 'Введите название задачи'
    return
  }
  if (trimmedTitle.length > TITLE_MAX_LENGTH) {
    validationError.value = `Название не должно превышать ${TITLE_MAX_LENGTH} символов`
    return
  }

  validationError.value = ''
  submitting.value = true

  try {
    const result = await tasksStore.createTask({
      title: trimmedTitle,
      description: description.value.trim() || null,
    })

    if (result.status === 'created') {
      title.value = ''
      description.value = ''
      apiError.value = ''
    } else if (result.status === 'error') {
      apiError.value = result.error.message
    }
    // 'skipped': another create is already running. Keep the input and show
    // nothing: the current submit button is already blocked.
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form
    class="task-form"
    novalidate
    @submit.prevent="submit"
  >
    <h2 class="task-form-title">
      Новая задача
    </h2>

    <div class="form-field">
      <label
        class="form-label"
        for="task-title"
      >
        Название
      </label>
      <input
        id="task-title"
        v-model="title"
        class="form-input"
        type="text"
        name="title"
        :maxlength="TITLE_MAX_LENGTH"
        autocomplete="off"
        :disabled="submitting"
        :aria-invalid="validationError ? 'true' : undefined"
        :aria-describedby="validationError ? 'task-title-error' : undefined"
        @input="clearValidationError"
      >
      <p
        v-if="validationError"
        id="task-title-error"
        class="field-error"
        role="alert"
      >
        {{ validationError }}
      </p>
    </div>

    <div class="form-field">
      <label
        class="form-label"
        for="task-description"
      >
        Описание <span class="form-hint">(необязательно)</span>
      </label>
      <textarea
        id="task-description"
        v-model="description"
        class="form-textarea"
        name="description"
        rows="3"
        :disabled="submitting"
      />
    </div>

    <p
      v-if="apiError"
      class="form-error"
      role="alert"
    >
      {{ apiError }}
    </p>

    <button
      type="submit"
      class="submit-button"
      :disabled="submitting"
    >
      {{ submitting ? 'Сохраняем…' : 'Добавить задачу' }}
    </button>
  </form>
</template>
