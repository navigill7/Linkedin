import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Search, MoreVertical, ArrowLeft, Loader, Image, Plus, UserPlus } from 'lucide-react';
import { useSelector } from 'react-redux';
import { io } from 'socket.io-client';

const CHAT_SERVICE_URL = process.env.REACT_APP_CHAT_SERVICE_URL || 'http://18.222.165.204:4000';
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://18.222.165.204:3001';

const ChatInterface = ({ isOpen, onClose }) => {
  const user = useSelector((state) => state.user);
  const token = useSelector((state) => state.token);
  
  const [socket, setSocket] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  
  const [showNewChat, setShowNewChat] = useState(false);
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchingUsers, setSearchingUsers] = useState(false);
  
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const userSearchTimeoutRef = useRef(null);

  // Socket initialization
  useEffect(() => {
    if (!isOpen || !token) return;

    const newSocket = io(CHAT_SERVICE_URL, {
      auth: { token },
      transports: ['websocket'],
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to chat service');
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from chat service');
    });

    setSocket(newSocket);

    return () => {
      console.log('🔌 Closing socket connection');
      newSocket.close();
    };
  }, [isOpen, token]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleFriendsOnline = ({ userIds }) => {
      setOnlineUsers(new Set(userIds));
    };

    const handleUserOnline = ({ userId }) => {
      setOnlineUsers(prev => new Set([...prev, userId]));
    };

    const handleUserOffline = ({ userId }) => {
      setOnlineUsers(prev => {
        const updated = new Set(prev);
        updated.delete(userId);
        return updated;
      });
    };

    const handleNewMessage = ({ message, conversationId }) => {
      console.log('📨 New message received:', message);
      
      if (selectedConversation && (selectedConversation._id === conversationId)) {
        setMessages(prevMessages => {
          const exists = prevMessages.some(msg => msg._id === message._id);
          if (exists) {
            console.log('⚠️ Duplicate message prevented');
            return prevMessages;
          }
          return [...prevMessages, message];
        });
      }

      setConversations(prevConversations => {
        const updated = prevConversations.map(conv => {
          if (conv._id === conversationId) {
            return {
              ...conv,
              lastMessage: message,
              lastMessageAt: message.createdAt,
              unreadCount: selectedConversation?._id === conversationId ? 0 : (conv.unreadCount || 0) + 1
            };
          }
          return conv;
        });
        
        return updated.sort((a, b) => {
          const dateA = a.lastMessageAt ? new Date(a.lastMessageAt) : new Date(0);
          const dateB = b.lastMessageAt ? new Date(b.lastMessageAt) : new Date(0);
          return dateB - dateA;
        });
      });
    };

    const handleTypingStart = ({ conversationId, userId, user: typingUser }) => {
      if (userId !== user._id && selectedConversation?._id === conversationId) {
        setTypingUsers(prev => ({
          ...prev,
          [conversationId]: typingUser,
        }));
      }
    };

    const handleTypingStop = ({ conversationId }) => {
      setTypingUsers(prev => {
        const updated = { ...prev };
        delete updated[conversationId];
        return updated;
      });
    };

    socket.on('friends:online', handleFriendsOnline);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);
    socket.on('message:new', handleNewMessage);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    return () => {
      socket.off('friends:online', handleFriendsOnline);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('message:new', handleNewMessage);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
    };
  }, [socket, selectedConversation, user?._id]);

  useEffect(() => {
    if (isOpen && token) {
      fetchConversations();
    }
  }, [isOpen, token]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (userSearchQuery.trim().length >= 2) {
      clearTimeout(userSearchTimeoutRef.current);
      userSearchTimeoutRef.current = setTimeout(() => {
        searchUsersForNewChat(userSearchQuery);
      }, 300);
    } else {
      setUserSearchResults([]);
    }

    return () => {
      if (userSearchTimeoutRef.current) {
        clearTimeout(userSearchTimeoutRef.current);
      }
    };
  }, [userSearchQuery]);

  const searchUsersForNewChat = async (query) => {
    try {
      setSearchingUsers(true);
      const response = await fetch(`${API_BASE_URL}/users/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        const filtered = data.filter(u => u._id !== user._id);
        setUserSearchResults(filtered);
      }
    } catch (error) {
      console.error('❌ Error searching users:', error);
    } finally {
      setSearchingUsers(false);
    }
  };

  const startNewConversation = (selectedUser) => {
    setShowNewChat(false);
    setUserSearchQuery('');
    setUserSearchResults([]);
    
    const existing = conversations.find(
      conv => conv.participant._id === selectedUser._id
    );
    
    if (existing) {
      selectConversation(existing);
      return;
    }
    
    const tempConversation = {
      _id: `temp-${selectedUser._id}`,
      participant: selectedUser,
      lastMessage: null,
      unreadCount: 0,
    };
    
    setSelectedConversation(tempConversation);
    setMessages([]);
  };

  const fetchConversations = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${CHAT_SERVICE_URL}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('❌ Error fetching conversations:', error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (conversationId) => {
    try {
      setLoading(true);
      const response = await fetch(
        `${CHAT_SERVICE_URL}/api/chat/conversations/${conversationId}/messages`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      setMessages(data.messages || []);
      
      if (socket) {
        socket.emit('conversation:join', conversationId);
        socket.emit('messages:read', { conversationId });
      }
    } catch (error) {
      console.error('❌ Error fetching messages:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const selectConversation = (conversation) => {
    if (selectedConversation && !selectedConversation._id.startsWith('temp-')) {
      socket?.emit('conversation:leave', selectedConversation._id);
    }
    
    setSelectedConversation(conversation);
    
    if (!conversation._id.startsWith('temp-')) {
      fetchMessages(conversation._id);
    } else {
      setMessages([]);
    }
  };

  const sendMessage = useCallback((e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    
    if (!newMessage.trim() || !selectedConversation || !socket) return;

    socket.emit('message:send', {
      recipientId: selectedConversation.participant._id,
      content: newMessage.trim(),
    });

    setNewMessage('');
    stopTyping();
  }, [newMessage, selectedConversation, socket]);

  const handleTyping = (e) => {
    setNewMessage(e.target.value);

    if (!selectedConversation || selectedConversation._id.startsWith('temp-') || !socket) return;

    socket.emit('typing:start', { conversationId: selectedConversation._id });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  const stopTyping = () => {
    if (selectedConversation && !selectedConversation._id.startsWith('temp-') && socket) {
      socket.emit('typing:stop', { conversationId: selectedConversation._id });
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const formatTime = (date) => {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const filteredConversations = conversations.filter(conv =>
    `${conv.participant.firstName} ${conv.participant.lastName}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end">
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="relative w-full sm:w-[950px] h-full sm:h-[700px] bg-white dark:bg-grey-800 sm:rounded-t-lg shadow-2xl flex overflow-hidden animate-slide-in border-x border-t border-grey-200 dark:border-grey-700">
        
        {/* Conversations Sidebar */}
        <div className={`${selectedConversation ? 'hidden sm:flex' : 'flex'} flex-col w-full sm:w-[350px] border-r border-grey-200 dark:border-grey-700 bg-white dark:bg-grey-800`}>
          <div className="p-3 border-b border-grey-200 dark:border-grey-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-grey-800 dark:text-grey-100">
                Messaging
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowNewChat(true)}
                  className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 transition-colors text-grey-600 dark:text-grey-400"
                  title="Compose message"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 transition-colors text-grey-600 dark:text-grey-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-500" />
              <input
                type="text"
                placeholder="Search messages"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 rounded bg-[#eef3f8] dark:bg-grey-700 border-none outline-none text-sm text-grey-700 dark:text-grey-100 focus:ring-1 focus:ring-grey-400 transition-all"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && conversations.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Loader className="w-5 h-5 text-[#0A66C2] animate-spin" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                <p className="text-sm text-grey-500 dark:text-grey-400">
                  {searchQuery ? 'No messages found.' : 'No messages yet.'}
                </p>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv._id}
                  onClick={() => selectConversation(conv)}
                  className={`w-full p-3 flex items-start gap-3 hover:bg-grey-50 dark:hover:bg-grey-700 transition-colors border-l-4 ${
                    selectedConversation?._id === conv._id 
                      ? 'bg-white dark:bg-grey-700 border-[#0A66C2]' 
                      : 'border-transparent'
                  }`}
                >
                  <div className="relative flex-shrink-0 mt-1">
                    <img
                      src={conv.participant.picturePath || '/default-avatar.png'}
                      alt={conv.participant.firstName}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                    {onlineUsers.has(conv.participant._id) && (
                      <span className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-green-600 rounded-full border-2 border-white dark:border-grey-800" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-baseline justify-between">
                      <p className={`text-sm font-semibold truncate ${
                        conv.unreadCount > 0 ? 'text-black dark:text-white' : 'text-grey-800 dark:text-grey-100'
                      }`}>
                        {conv.participant.firstName} {conv.participant.lastName}
                      </p>
                      {conv.lastMessage && (
                        <span className="text-[11px] text-grey-500 ml-2 whitespace-nowrap uppercase">
                          {formatTime(conv.lastMessage.createdAt)}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs truncate ${
                      conv.unreadCount > 0 ? 'font-semibold text-black dark:text-white' : 'text-grey-500 dark:text-grey-400'
                    }`}>
                      {conv.lastMessage?.content || 'New conversation'}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* New Chat Modal (LinkedIn Style Overlays) */}
        {showNewChat && (
          <div className="absolute inset-0 bg-white dark:bg-grey-800 z-10 flex flex-col sm:w-[350px] border-r border-grey-200 dark:border-grey-700 animate-slide-in">
            <div className="p-3 border-b border-grey-200 dark:border-grey-700">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-grey-800 dark:text-grey-100">
                  New message
                </h2>
                <button
                  onClick={() => {
                    setShowNewChat(false);
                    setUserSearchQuery('');
                    setUserSearchResults([]);
                  }}
                  className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 text-grey-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-500" />
                <input
                  type="text"
                  placeholder="Type a name..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 rounded bg-[#eef3f8] dark:bg-grey-700 border-none outline-none text-sm text-grey-700 dark:text-grey-100 focus:ring-1 focus:ring-grey-400"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {searchingUsers ? (
                <div className="flex items-center justify-center h-full">
                  <Loader className="w-5 h-5 text-[#0A66C2] animate-spin" />
                </div>
              ) : userSearchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                  <p className="text-sm text-grey-500 dark:text-grey-400">
                    {userSearchQuery.length < 2
                      ? 'Type to search connections'
                      : 'No connections found'}
                  </p>
                </div>
              ) : (
                userSearchResults.map((searchUser) => (
                  <button
                    key={searchUser._id}
                    onClick={() => startNewConversation(searchUser)}
                    className="w-full p-3 flex items-center gap-3 hover:bg-grey-50 dark:hover:bg-grey-700 transition-colors"
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={searchUser.picturePath || '/default-avatar.png'}
                        alt={searchUser.firstName}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-semibold text-grey-800 dark:text-grey-100 truncate">
                        {searchUser.firstName} {searchUser.lastName}
                      </p>
                      <p className="text-xs text-grey-500 dark:text-grey-400 truncate">
                        {searchUser.Year || 'Student'}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Chat Area */}
        {selectedConversation ? (
          <div className="flex-1 flex flex-col bg-white dark:bg-grey-800">
            {/* Chat Header */}
            <div className="px-4 py-3 border-b border-grey-200 dark:border-grey-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="sm:hidden p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 text-grey-600"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="relative">
                  <img
                    src={selectedConversation.participant.picturePath || '/default-avatar.png'}
                    alt={selectedConversation.participant.firstName}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-grey-800 dark:text-grey-100 leading-tight">
                    {selectedConversation.participant.firstName} {selectedConversation.participant.lastName}
                  </h3>
                  <p className="text-[11px] text-grey-500 dark:text-grey-400">
                    {onlineUsers.has(selectedConversation.participant._id) ? 'Available on mobile' : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 text-grey-500">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader className="w-5 h-5 text-[#0A66C2] animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <img
                    src={selectedConversation.participant.picturePath || '/default-avatar.png'}
                    alt={selectedConversation.participant.firstName}
                    className="w-20 h-20 rounded-full object-cover mb-4"
                  />
                  <h4 className="text-lg font-semibold text-grey-800 dark:text-grey-100">
                    {selectedConversation.participant.firstName} {selectedConversation.participant.lastName}
                  </h4>
                  <p className="text-sm text-grey-500 dark:text-grey-400 mt-1">
                    Say hello to start the conversation!
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((msg, index) => {
                    const isOwn = msg.sender._id === user._id;
                    const showAvatar = index === 0 || messages[index - 1].sender._id !== msg.sender._id;
                    
                    return (
                      <div
                        key={msg._id}
                        className={`flex items-start gap-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                        {!isOwn && (
                          <div className="w-8 h-8 flex-shrink-0">
                            {showAvatar && (
                              <img
                                src={msg.sender.picturePath || '/default-avatar.png'}
                                alt={msg.sender.firstName}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            )}
                          </div>
                        )}
                        <div className={`max-w-[75%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                          {showAvatar && (
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-xs font-semibold text-grey-700 dark:text-grey-200">
                                {isOwn ? 'You' : msg.sender.firstName}
                              </span>
                              <span className="text-[10px] text-grey-400">
                                {formatTime(msg.createdAt)}
                              </span>
                            </div>
                          )}
                          <div className={`px-3 py-2 text-sm rounded-lg ${
                            isOwn 
                              ? 'bg-[#eef3f8] dark:bg-grey-700 text-grey-800 dark:text-grey-100 rounded-tr-none' 
                              : 'bg-white dark:bg-grey-800 border border-grey-200 dark:border-grey-700 text-grey-800 dark:text-grey-100 rounded-tl-none shadow-sm'
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {typingUsers[selectedConversation._id] && (
                    <div className="flex items-center gap-2 text-grey-400">
                      <div className="flex gap-1">
                        <span className="w-1 h-1 bg-grey-400 rounded-full animate-bounce" />
                        <span className="w-1 h-1 bg-grey-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1 h-1 bg-grey-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                      <span className="text-xs italic">
                        {typingUsers[selectedConversation._id].firstName} is typing...
                      </span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-grey-200 dark:border-grey-700 bg-white dark:bg-grey-800">
              <form 
                onSubmit={sendMessage}
                className="flex flex-col gap-3 rounded-lg border border-grey-300 dark:border-grey-600 focus-within:border-grey-500 focus-within:ring-1 focus-within:ring-grey-400 transition-all p-2"
              >
                <textarea
                  placeholder="Write a message..."
                  value={newMessage}
                  onChange={handleTyping}
                  onKeyDown={handleKeyPress}
                  className="w-full p-2 bg-transparent border-none outline-none resize-none text-sm text-grey-700 dark:text-grey-100 min-h-[60px]"
                />
                <div className="flex items-center justify-between pt-2 border-t border-grey-100 dark:border-grey-700">
                  <div className="flex items-center gap-1">
                    <button type="button" className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 text-grey-500">
                      <Image className="w-5 h-5" />
                    </button>
                    <button type="button" className="p-1.5 rounded-full hover:bg-grey-100 dark:hover:bg-grey-700 text-grey-500">
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className={`px-4 py-1 rounded-full text-sm font-semibold transition-colors ${
                      newMessage.trim() 
                        ? 'bg-[#0A66C2] text-white hover:bg-[#004182]' 
                        : 'bg-grey-100 text-grey-400 cursor-not-allowed'
                    }`}
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 hidden sm:flex flex-col items-center justify-center bg-white dark:bg-grey-800">
            <div className="text-center px-12">
              <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                <Send className="w-8 h-8 text-[#0A66C2]" />
              </div>
              <h3 className="text-xl font-medium text-grey-800 dark:text-grey-100 mb-2">
                Your messages
              </h3>
              <p className="text-sm text-grey-500 dark:text-grey-400">
                Send private photos and messages to a connection.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;