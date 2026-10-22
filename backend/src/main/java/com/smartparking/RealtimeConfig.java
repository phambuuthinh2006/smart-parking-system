package com.smartparking;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.messaging.*;
import org.springframework.messaging.simp.config.*;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.messaging.support.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.servlet.config.annotation.*;
import org.springframework.web.socket.config.annotation.*;

@Configuration
@EnableWebSocketMessageBroker
public class RealtimeConfig implements WebSocketMessageBrokerConfigurer {

  private final String[] origins;

  public RealtimeConfig(@Value("${parking.allowed-origins}") String origins) {
    this.origins = AllowedOrigins.parse(origins);
  }

  @Bean
  public ThreadPoolTaskScheduler brokerHeartbeatScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("stomp-heartbeat-");
    return scheduler;
  }

  // Database expiry may wait on a row lock. Keep it off the broker heartbeat thread.
  @Bean
  public ThreadPoolTaskScheduler taskScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("device-expiry-");
    return scheduler;
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    registry.addEndpoint("/ws").setAllowedOrigins(origins);
  }

  @Override
  public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry
      .enableSimpleBroker("/topic")
      .setHeartbeatValue(new long[] { 10000, 10000 })
      .setTaskScheduler(brokerHeartbeatScheduler());
    registry.setApplicationDestinationPrefixes("/app");
    registry.setPreservePublishOrder(true);
  }

  @Override
  public void configureClientInboundChannel(ChannelRegistration registration) {
    registration.interceptors(
      new ChannelInterceptor() {
        @Override
        public Message<?> preSend(Message<?> message, MessageChannel channel) {
          var accessor = MessageHeaderAccessor.getAccessor(
            message,
            StompHeaderAccessor.class
          );
          if (
            accessor != null &&
            (accessor.getCommand() == StompCommand.SEND ||
              (accessor.getCommand() == StompCommand.SUBSCRIBE &&
                !"/topic/parking".equals(accessor.getDestination())))
          ) throw new MessageDeliveryException(
            "Client publishing and other subscriptions are disabled"
          );
          return message;
        }
      }
    );
  }

  @Override
  public void configureWebSocketTransport(
    WebSocketTransportRegistration registry
  ) {
    registry
      .setMessageSizeLimit(8192)
      .setSendBufferSizeLimit(262144)
      .setSendTimeLimit(10000);
  }
}
