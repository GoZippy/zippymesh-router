# Page snapshot

```yaml
- generic [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "Zippy Mesh Router" [level=1] [ref=e6]
      - paragraph [ref=e7]: Set up takes about 5 minutes
    - generic [ref=e14]:
      - generic [ref=e15]:
        - generic [ref=e17]: shield
        - generic [ref=e18]:
          - paragraph [ref=e19]: Step 1 of 5
          - heading "Set a password" [level=2] [ref=e20]
      - generic [ref=e21]:
        - paragraph [ref=e22]:
          - text: Choose a dashboard password. You can change it any time in
          - strong [ref=e23]: Settings → Profile
          - text: .
        - generic [ref=e24]:
          - generic [ref=e25]: Password*
          - textbox "At least 4 characters" [active] [ref=e27]
        - generic [ref=e28]:
          - generic [ref=e29]: Confirm password*
          - textbox "Repeat your password" [ref=e31]
        - button "Continue" [ref=e32] [cursor=pointer]
    - paragraph [ref=e33]:
      - text: Already set up?
      - link "Skip to dashboard" [ref=e34] [cursor=pointer]:
        - /url: /dashboard
```