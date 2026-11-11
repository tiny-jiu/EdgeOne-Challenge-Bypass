# EdgeOne Challenge Analysis

What looks like a single CAPTCHA is actually two separate systems. The page first runs a JavaScript challenge, then loads a widget with its own session and verification flow. Treating them as one problem makes the whole thing harder to understand.

## 1. The first challenge

The initial page writes `__tst_status` and `EO_Bot_Ssid` cookies. Although the script is obfuscated, the values needed for the calculation can be extracted from the response without executing it.

There is no reason to read every line of the obfuscated code. Only the expressions producing those two cookies matter. Once the values are recovered and sent back, the page moves on to the real widget.

## 2. The widget has its own state

The widget calls `cap_union_prehandle` and receives a fresh `sess`, together with its configuration and optional PoW parameters. Its request also carries the `deviceID` needed later.

These values belong to one particular exchange. Copying them from an older capture breaks that relationship.

The browser adds another complication. The CAPTCHA iframe may run as a separate CDP target, so the top-level page does not necessarily expose the TDC instance belonging to the current `sess`. Attaching to the correct target is what makes the next step possible.

## 3. TDC without reversing the VM

TDC is the most intimidating part of the flow. It collects browser and interaction data, then returns the values used as `collect` and `eks`.

Reimplementing it would mean dealing with virtualized code, browser probes, internal state, and output encoding. A more useful approach is to leave the collector alone and examine the state it accepts.

The widget exposes `setData`, `getData`, and `getInfo`. Through `setData`, it accepts entry state and pointer information such as `slideValue`, layout positions, and client size. Pointer records use a compact structure:

```text
[type, dx, dy, dt, isFake]
```

That changes the problem. Instead of forging TDC output, the genuine collector can process programmatically supplied movement and timing data. `getData(true)` then returns `collect`, while `getInfo()` supplies `eks`.

The breakthrough is the use of the real component, not a new encoder.

## 4. PoW and the final ticket

When PoW is enabled, the server provides a prefix and an MD5 target. The task is simply to find a nonce that satisfies `MD5(prefix + nonce)`. It adds computational work but says nothing about whether the interaction was genuine.

The final verification combines the active `sess`, `deviceID`, TDC output, the answer structure, and the PoW result. A response with `errorCode=0` returns a ticket, which is used as the `EO-Bot-Captcha-Token` cookie.

HTTP 200 alone is not a useful success signal because a challenge page can also return 200. The meaningful result is a valid ticket followed by a page that no longer presents the challenge.
