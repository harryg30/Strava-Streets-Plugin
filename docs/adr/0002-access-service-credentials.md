# Access Service owns Maps credentials; Dev Key Override is non-Store only

Store Phase users must not receive our master Google API key, and “everyone pastes their own key” fights billing and quota. The extension obtains short-lived Maps access from a project-owned Access Service after membership and quota checks. A Dev Key Override may exist for local debugging when the Access Service is down, and must never be enabled in Store builds.
