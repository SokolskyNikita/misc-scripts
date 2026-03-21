# misc-scripts

Small, focused scripts for everyday automation and workflow speed-ups.

## scripts

### `tampermonkey/photofeeler-auto-submit.js`

Automates the Photofeeler "new test" flow (category, subject, target voters, and test size).

Configure settings in the script UI (saved persistently in Tampermonkey):

- Open settings from the Tampermonkey menu, `Alt+Shift+P`, or the `Auto setup` floating button.
- Set `category`, `subject` (`gender`, `age`), `voters` (`gender`, age range slider), `test size`, and `auto-next`.

## notes

- Selectors may need updates if Photofeeler changes its UI.
