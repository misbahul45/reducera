<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; thinking?: boolean }>(), { size: 'md', thinking: false })
</script>

<template>
  <svg
    class="rc-core"
    :class="[`rc-core--${size}`, { 'rc-core--thinking': thinking }]"
    viewBox="0 0 64 64"
    width="48"
    height="48"
    aria-hidden="true"
    focusable="false"
  >
    <line class="rc-core__stem" x1="32" y1="14" x2="32" y2="7" />
    <circle class="rc-core__bulb" cx="32" cy="5.5" r="3.5" />
    <rect class="rc-core__ear" x="3.5" y="25" width="8" height="14" rx="4" />
    <rect class="rc-core__ear" x="52.5" y="25" width="8" height="14" rx="4" />
    <rect class="rc-core__head" x="9" y="13" width="46" height="38" rx="13" />
    <rect class="rc-core__shine" x="14" y="16.5" width="20" height="4" rx="2" />
    <rect class="rc-core__visor" x="15" y="21" width="34" height="24" rx="9" />
    <g class="rc-core__eyes">
      <ellipse class="rc-core__eye" cx="25.5" cy="31.5" rx="3.6" ry="4.2" />
      <ellipse class="rc-core__eye" cx="38.5" cy="31.5" rx="3.6" ry="4.2" />
    </g>
    <path class="rc-core__mouth" d="M27 39.5 Q32 43.5 37 39.5" />
    <rect class="rc-core__neck" x="22" y="51" width="20" height="9" rx="4" />
    <circle class="rc-core__chest" cx="32" cy="55.5" r="2" />
  </svg>
</template>

<style>
.rc-core {
  flex: none;
  display: block;
  overflow: visible;
}
.rc-core--sm {
  width: 1.75rem;
  height: 1.75rem;
}
.rc-core--md {
  width: 2.5rem;
  height: 2.5rem;
}
.rc-core--lg {
  width: 3.5rem;
  height: 3.5rem;
}
.rc-core__stem {
  stroke: var(--rc-secondary-depth);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.rc-core__bulb {
  fill: var(--rc-gold);
  stroke: var(--rc-gold-depth);
  stroke-width: 1.5;
}
.rc-core__ear {
  fill: var(--rc-secondary);
  stroke: var(--rc-secondary-depth);
  stroke-width: 2;
}
.rc-core__head {
  fill: var(--rc-primary);
  stroke: var(--rc-primary-depth);
  stroke-width: 2.5;
}
.rc-core__shine {
  fill: var(--rc-primary-fg);
  opacity: 0.28;
}
.rc-core__visor {
  fill: var(--rc-secondary-depth);
  stroke: var(--rc-primary-depth);
  stroke-width: 1.5;
}
.rc-core__eye {
  fill: var(--rc-gold);
  transform-box: fill-box;
  transform-origin: center;
}
.rc-core__mouth {
  fill: none;
  stroke: var(--rc-gold);
  stroke-width: 2.2;
  stroke-linecap: round;
}
.rc-core__neck {
  fill: var(--rc-secondary);
  stroke: var(--rc-secondary-depth);
  stroke-width: 2;
}
.rc-core__chest {
  fill: var(--rc-gold);
}
@media (prefers-reduced-motion: no-preference) {
  .rc-core__eye {
    animation: rc-core-blink 5.5s infinite;
  }
  .rc-core--thinking .rc-core__eye {
    animation-duration: 1.6s;
  }
  .rc-core__bulb {
    transform-box: fill-box;
    transform-origin: center;
  }
  .rc-core--thinking .rc-core__bulb {
    animation: rc-core-pulse 0.9s ease-in-out infinite;
  }
}
@keyframes rc-core-blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.1);
  }
}
@keyframes rc-core-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.35);
  }
}
</style>
