# github-misc-scripts

Small, focused scripts for everyday automation.

## included scripts

- `tampermonkey/photofeeler-auto-submit.js`: Tampermonkey userscript that accelerates Photofeeler test setup by auto-selecting category, filling subject + target voter settings, optionally auto-clicking Next, and selecting a configured test size.

## quick start

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new userscript and paste the contents of `tampermonkey/photofeeler-auto-submit.js`.
3. Adjust the `CFG` object at the top of the script to your preferences.
4. Open Photofeeler and start a new test.

## notes

- This script is intended for personal workflow speed-up.
- Selectors may need updates if Photofeeler changes its UI.
