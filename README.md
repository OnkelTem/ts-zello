# TypeScript Zello backend client library

This is a library for creating bots for [Zello](https://zello.com/) push-to-talk app.

It uses [Zello Channel API](https://github.com/zelloptt/zello-channel-api) directly.

The library is still in development and currently can:

- monitor channel activity
- send and receive text messages  
- send and receive audio

See below for the relevant development status.

## Quick start

```
npm install ts-zello
```

## Key concepts

Two main ideas of this library are:
- Make writing bots easy.
- Run bot tasks in parallel.

The main (and the only) runnable export of the library is the `zello()` function.

When you run it, it immediately connects to a server:

```ts
import { zello } from 'ts-zello';

const z = await zello("wss://zello.io/ws");
```

It returns an object of the `Zello` type:

```ts
type Zello = {
  name: string;
  ctl: Readonly<Ctl>;
  events: Readonly<Events>;
  commands: Readonly<Commands>;
  macros: Readonly<ReturnType<typeof getMacros>>;
  awaits: Readonly<Awaits>;
  logger: Logger;
};
```

which provides a set of tools for creating bot script.

The object properties are:

- `name` - a name used for logging. Defaults to: `bot`. Useful for logging on bot activities,
if there are more than one running at the same time.
- `ctl` - an object with 3 methods: 
    - `run()` - runs a user script (see below).
    - `status()` - returns the socket status (CONNECTING, OPEN, CLOSING, CLOSED).
    - `close()` - closes connection to the Zello server.
- `events` - Zello API base event wrappers like `onChannelStatus()` and `onTextMessage()`,
  as well as derived events like `onAudioData()`.
- `awaits` - promisified version of events with events filtering callback.
- `commands` - Zello API base command wrappers like `logon()` and `sendTextMessage()`.
- `macros` - a set of handy scripts which you would like to use instead of commands 
  in some cases. For example, `macros.login()` macro performs full login procedure including
  checking channel availability while `commands.logon()` doesn't do that. 
- `logger` - a shortcut to the [pino logger](https://www.npmjs.com/package/pino) instance used under the cover.





### Running user script




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
- [x] start_stream
- [x] stop_stream
- [ ] send_image
- [x] send_text_message
- [ ] send_location


### Implemented events
- [x] on_channel_status
- [x] on_stream_start
- [x] on_stream_stop
- [x] on_error
- [ ] on_image
- [x] on_text_message
- [ ] on_location

### TODO
- [x] Create a sample npm package with a bot which is using this library.
- [x] Add examples

