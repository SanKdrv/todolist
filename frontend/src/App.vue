<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink
        class="brand"
        to="/"
      >TaskFlow</RouterLink>
    </header>

    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>
