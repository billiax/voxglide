# Custom Tools

VoxGlide has built-in tools for DOM interaction (fill fields, click elements, read content, navigate). You can extend it with your own tools in two ways.

## Config-Time Registration

Define tools when initializing the SDK:

```typescript
const sdk = new VoiceSDK({
  serverUrl: 'wss://your-server.com',
  actions: {
    custom: {
      addToCart: {
        declaration: {
          name: 'addToCart',
          description: 'Add a product to the shopping cart',
          parameters: {
            type: 'OBJECT',
            properties: {
              productId: { type: 'STRING', description: 'Product ID' },
              quantity: { type: 'NUMBER', description: 'Quantity' },
            },
            required: ['productId'],
          },
        },
        handler: async (args) => {
          await cart.add(args.productId, args.quantity ?? 1);
          return { success: true, cartSize: cart.size };
        },
      },
    },
  },
});
```

## Runtime Registration

Register (and unregister) tools after initialization:

```typescript
sdk.registerAction('showModal', {
  declaration: {
    name: 'showModal',
    description: 'Show a modal dialog',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Modal title' },
      },
      required: ['title'],
    },
  },
  handler: (args) => {
    openModal(args.title);
    return { success: true };
  },
});

// Later:
sdk.removeAction('showModal');
```

## Page-Defined Tools (nbt_functions)

Pages can expose tools via `window.nbt_functions` without any SDK configuration. The SDK auto-discovers them on load and polls for changes every 2 seconds.

```html
<script>
  window.nbt_functions = {
    lookupOrder: {
      description: 'Look up an order by ID',
      parameters: {
        orderId: { type: 'string', description: 'The order ID', required: true },
      },
      handler: async (args) => {
        return await fetch(`/api/orders/${args.orderId}`).then(r => r.json());
      },
    },
  };
</script>
```

You can also notify the SDK of changes immediately instead of waiting for the poll:

```javascript
window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));
```

### When to use which

| Approach | Best for |
|----------|----------|
| **Config-time** (`actions.custom`) | You control the SDK integration and want tools defined in your app code |
| **Runtime** (`registerAction`) | Tools that depend on component lifecycle (e.g., React hooks) |
| **Page-defined** (`nbt_functions`) | Page authors who don't touch SDK config, or dynamic tool sets |

All three approaches are equivalent once registered — they go through the same ActionRouter and appear identically to the AI.
