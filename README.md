# TypeScript Zello backend client library

This is a library for creating bots for [Zello](https://zello.com/) push-to-talk app.

It uses [Zello Channel API](https://github.com/zelloptt/zello-channel-api) directly.

The library is still in development and currently can:

- monitor channel activity
- send and receive text messages
- send and receive audio

See below for the relevant development status.

## Quick start

_TODO_

## Library

_TODO_

## Examples

Check out the `./examples` directory.

_TODO_

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
- [ ] Finish this README
- [ ] Publish on http://npmjs.com

## Contribution

```
$ sudo apt-get install libasound2-dev
```

