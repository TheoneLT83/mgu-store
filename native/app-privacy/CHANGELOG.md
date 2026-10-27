# app-privacy changelog

## 1.3.0

- A local-only app that crashes is only restarted: its data is kept, it stays installed and its tile stays enabled. After 5 restarts in 10 minutes, the next crash leaves it stopped until it is started again (its tile, MainApp, or the next boot); deaths while the head unit shuts down do not count. Other apps keep MainApp's crash recovery.
