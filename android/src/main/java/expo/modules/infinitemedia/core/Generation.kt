package expo.modules.infinitemedia.core

/** Identity of one item-to-slot binding. Async work captures it and checks it before touching views. */
data class Binding(val itemId: String, val generation: Long)

/** Main-thread only, so no atomics. */
object Generations {
  private var counter = 0L
  fun next(itemId: String) = Binding(itemId, ++counter)
}

/** The single guard every async completion goes through. */
fun Binding?.matches(other: Binding?): Boolean = this != null && this == other
