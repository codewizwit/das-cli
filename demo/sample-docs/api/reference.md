# API Reference

The complete reference for the Widget runtime. Every method below is stable as of v2 and follows the same argument-validation and chaining conventions.

## create()

Create a new widget instance from an options object.

`create` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `create` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `create` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `create` can be chained with other calls.

### Example

```js
widget.create({ verbose: true }).render();
```

## mount()

Attach the widget to a DOM element and begin rendering.

`mount` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `mount` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `mount` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `mount` can be chained with other calls.

### Example

```js
widget.mount({ verbose: true }).render();
```

## unmount()

Detach the widget from the DOM and release its listeners.

`unmount` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `unmount` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `unmount` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `unmount` can be chained with other calls.

### Example

```js
widget.unmount({ verbose: true }).render();
```

## render()

Re-render the widget from its current state.

`render` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `render` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `render` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `render` can be chained with other calls.

### Example

```js
widget.render({ verbose: true }).render();
```

## setState()

Merge a partial state update and schedule a render.

`setState` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `setState` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `setState` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `setState` can be chained with other calls.

### Example

```js
widget.setState({ verbose: true }).render();
```

## getState()

Return an immutable snapshot of the widget state.

`getState` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `getState` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `getState` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `getState` can be chained with other calls.

### Example

```js
widget.getState({ verbose: true }).render();
```

## on()

Subscribe a handler to a named lifecycle event.

`on` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `on` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `on` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `on` can be chained with other calls.

### Example

```js
widget.on({ verbose: true }).render();
```

## off()

Remove a previously subscribed event handler.

`off` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `off` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `off` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `off` can be chained with other calls.

### Example

```js
widget.off({ verbose: true }).render();
```

## emit()

Dispatch a named event to every subscribed handler.

`emit` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `emit` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `emit` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `emit` can be chained with other calls.

### Example

```js
widget.emit({ verbose: true }).render();
```

## configure()

Set global defaults applied to every new widget.

`configure` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `configure` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `configure` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `configure` can be chained with other calls.

### Example

```js
widget.configure({ verbose: true }).render();
```

## use()

Register a plugin that hooks into the widget lifecycle.

`use` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `use` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `use` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `use` can be chained with other calls.

### Example

```js
widget.use({ verbose: true }).render();
```

## destroy()

Tear down the widget and free all held resources.

`destroy` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `destroy` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `destroy` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `destroy` can be chained with other calls.

### Example

```js
widget.destroy({ verbose: true }).render();
```

## clone()

Produce a deep copy of the widget and its state.

`clone` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `clone` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `clone` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `clone` can be chained with other calls.

### Example

```js
widget.clone({ verbose: true }).render();
```

## freeze()

Make the widget read-only until it is thawed.

`freeze` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `freeze` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `freeze` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `freeze` can be chained with other calls.

### Example

```js
widget.freeze({ verbose: true }).render();
```

## thaw()

Re-enable mutation on a frozen widget.

`thaw` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `thaw` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `thaw` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `thaw` can be chained with other calls.

### Example

```js
widget.thaw({ verbose: true }).render();
```

## batch()

Group several state updates into a single render.

`batch` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `batch` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `batch` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `batch` can be chained with other calls.

### Example

```js
widget.batch({ verbose: true }).render();
```

## focus()

Move keyboard focus to the widget's root element.

`focus` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `focus` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `focus` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `focus` can be chained with other calls.

### Example

```js
widget.focus({ verbose: true }).render();
```

## blur()

Remove keyboard focus from the widget.

`blur` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `blur` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `blur` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `blur` can be chained with other calls.

### Example

```js
widget.blur({ verbose: true }).render();
```

## serialize()

Return a JSON-safe representation of the widget.

`serialize` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `serialize` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `serialize` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `serialize` can be chained with other calls.

### Example

```js
widget.serialize({ verbose: true }).render();
```

## restore()

Rebuild a widget from a serialized representation.

`restore` is part of the core widget surface. It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code does not need to guard against timing.

On failure `restore` throws synchronously with a message that names the offending argument and the expected shape. It never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call, which keeps error recovery simple.

### Parameters

- `options` an object controlling how `restore` behaves; every field is optional and falls back to the value set through `configure`.
- `signal` an optional AbortSignal that cancels the operation if the surrounding scope is torn down before it completes.

### Returns

The widget instance, so `restore` can be chained with other calls.

### Example

```js
widget.restore({ verbose: true }).render();
```
