# API Reference

The complete reference for the Widget runtime. Every method is stable as of v2.

## create()

Create a new widget instance from an options object.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.create({ verbose: true }).render();
```

## mount()

Attach the widget to a DOM element and begin rendering.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.mount({ verbose: true }).render();
```

## setState()

Merge a partial state update and schedule a render.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.setState({ verbose: true }).render();
```

## on()

Subscribe a handler to a named lifecycle event.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.on({ verbose: true }).render();
```

## configure()

Set global defaults applied to every new widget.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.configure({ verbose: true }).render();
```

## destroy()

Tear down the widget and free all held resources.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

It validates its arguments up front, updates the widget's internal bookkeeping, and returns the instance so calls can be chained fluently. When it is called before the widget has mounted, the operation is queued and replayed in order once mounting completes, so setup code never has to guard against timing. On failure it throws synchronously with a message that names the offending argument and the expected shape, and it never partially applies a change: either the whole operation succeeds or the widget is left exactly as it was before the call. This keeps error recovery simple and makes the method safe to retry after a caught exception. Every option field is optional and falls back to the value set through configure, so common setups stay terse.

### Example

```js
widget.destroy({ verbose: true }).render();
```
