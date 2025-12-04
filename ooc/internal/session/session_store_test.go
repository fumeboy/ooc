package session

import "testing"

// TestMemoryStoreSaveLoad 验证会话保存与加载流程。
func TestMemoryStoreSaveLoad(t *testing.T) {
	store := NewMemoryStore()
	sess := &Session{
		UserRequest: "Hello",
		StoryName:   "Hello",
	}

	id, err := store.SaveSession(sess)
	if err != nil {
		t.Fatalf("save session failed: %v", err)
	}

	loaded, ok := store.GetSession(id)
	if !ok {
		t.Fatalf("session not found")
	}
	if loaded.UserRequest != sess.UserRequest {
		t.Fatalf("unexpected user request")
	}
}

// TestMemoryStoreAppendEvent 验证事件追加与顺序。
func TestMemoryStoreAppendEvent(t *testing.T) {
	store := NewMemoryStore()
	id, err := store.SaveSession(&Session{UserRequest: "Goal"})
	if err != nil {
		t.Fatalf("save session failed: %v", err)
	}

	evt1 := &Event{Type: EventConversationStarted, Payload: "start"}
	evt2 := &Event{Type: EventActionExecuted, Payload: "action"}

	if _, err := store.AppendEvent(id, evt1); err != nil {
		t.Fatalf("append event1 failed: %v", err)
	}
	if _, err := store.AppendEvent(id, evt2); err != nil {
		t.Fatalf("append event2 failed: %v", err)
	}

	evts, err := store.ListEvents(id)
	if err != nil {
		t.Fatalf("list events failed: %v", err)
	}
	if len(evts) != 2 {
		t.Fatalf("expected 2 events, got %d", len(evts))
	}
	if evts[0].Type != EventConversationStarted || evts[1].Type != EventActionExecuted {
		t.Fatalf("events order mismatch")
	}
}
