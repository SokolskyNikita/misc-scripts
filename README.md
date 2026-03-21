# misc-scripts

Small, focused scripts for everyday automation and workflow speed-ups.

## scripts

### `tampermonkey/photofeeler-auto-submit.js`

Automates the Photofeeler "new test" flow (category, subject, target voters, and test size).

Configure the `CFG` object at the top of the file:

- `category`: `dating` | `business` | `social`
- `subject`: `gender` and `age`
- `voters`: `gender`, `ageSliderMin`, `ageSliderMax`
- `testSize`: `0`, `10`, `20`, `40`, or `80`
- `autoNext`: `true` or `false`

## notes

- Selectors may need updates if Photofeeler changes its UI.
