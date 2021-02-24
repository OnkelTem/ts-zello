# TypeScript Zello backend client library

This is a library for creating bots for [Zello](https://zello.com/) push-to-talk app.

It uses [Zello Channel API](https://github.com/zelloptt/zello-channel-api) directly.

The library is at the early stages of development and currently is able 
to do just a few basic things.

See below for the relevant development status.

## Key concepts

Two main ideas of this library are:
- Make writing bots easy.
- Run many bots in parallel.

One of the ways to achieve that in the asynchronous world — is 
via JavaScript [generator functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator).   

So your bot is actually a generator function:

```ts
function* myBot() {
  yield action1();
  yield action2();
  yield action3();
}
```

The main (and the only) runnable export of the library is the `zello()` function.

When you run it, it immediately connects to a server:

```ts
import { zello } from 'ts-zello';

const ctl = await zello("wss://zello.io/ws");
```

and returns an object of the `Ctl` type:

```ts
export interface Ctl {
  readonly close: () => Promise<void>;
  readonly status: () => void;
  readonly run: (script: Script) => Promise<void>;
}
```

Finally, you pass your script callback to the `run()` function:

```ts
await ctl.run(myBot);
```

The script gets parameterized with an object of the `ScriptProps` type:

```ts
export interface ScriptProps {
  readonly ctl: Ctl;
  readonly events: Events;
  readonly commands: Commands;
}
```

This way it gets access to Zello [commands and events](https://github.com/zelloptt/zello-channel-api/blob/master/API.md).

## Examples

### Send a text message

Here is a sample code of a bot which connects to the public server and sends 
the `Hello, World!` text to the channel `My Super Chan`:

```ts
async function myBot() {
  const z = await zello("wss://zello.io/ws", function* ({ commands }) {
    yield commands.logon({
      username: "youname",
      password: "yourpass",
      auth_token: "eyJhb...",
      channel: "My Super Chan"
    });
    yield commands.sendTextMessage({ text: 'Hello, World!' });
  });
  await z.close();
}
```

More examples yet to come. Meanwhile, check out the tests code: [test/zello.test.ts](test/zello.test.ts).

## Running tests

Tests run against a real Zello server using real user accounts.

So you need to have a few working Zello 
accounts and their respective [tokens](https://github.com/zelloptt/zello-channel-api/blob/master/AUTH.md) first.
(Currently, **two** such accounts are used in the tests).

You will also need to provide a real channel name.

Then create the `credentials.json` file in [test/fixtures/](test/fixtures/) directory. 

You can use the [test/fixtures/credentials.default.json](test/fixtures/credentials.default.json) template for that.

Then just run: `$ npm run test`.

## Why TypeScript?

Basically because it's a popular and yet ~~normal~~ statically typed programming language.

## Development Status

### Implemented commands
- [x] logon
- [ ] start_stream
- [ ] stop_stream
- [ ] send_image
- [x] send_text_message
- [ ] send_location


### Implemented events
- [x] on_channel_status
- [ ] on_stream_start
- [ ] on_stream_stop
- [x] on_error
- [ ] on_image
- [x] on_text_message
- [ ] on_location

### TODO
- [ ] Create a sample npm package with a bot which is using this library.
- [ ] Add examples

