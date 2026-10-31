package com.technext.pay.payment;
import com.technext.pay.identity.MerchantPrincipal;import jakarta.validation.Valid;import jakarta.validation.constraints.*;import org.springframework.http.HttpStatus;import org.springframework.security.core.annotation.AuthenticationPrincipal;import org.springframework.web.bind.annotation.*;import java.time.Instant;import java.util.*;
@RestController @RequestMapping("/api/v1/orders") public class OrderController{
 private final OrderService service;public OrderController(OrderService s){service=s;}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) public OrderResponse create(@AuthenticationPrincipal MerchantPrincipal p,@RequestHeader(value="X-Idempotency-Key",required=false) String key,@Valid @RequestBody CreateOrderRequest body){return OrderResponse.from(service.create(p.merchantId(),body.amount(),body.currency()==null?"INR":body.currency(),body.description(),key));}
 @GetMapping public List<OrderResponse> list(@AuthenticationPrincipal MerchantPrincipal p){return service.list(p.merchantId()).stream().map(OrderResponse::from).toList();}
 @GetMapping("/{id}") public OrderResponse get(@AuthenticationPrincipal MerchantPrincipal p,@PathVariable UUID id){return OrderResponse.from(service.get(p.merchantId(),id));}
 @PostMapping("/{id}/sandbox-result") public OrderResponse simulate(@AuthenticationPrincipal MerchantPrincipal p,@PathVariable UUID id,@RequestParam SandboxOutcome outcome){return OrderResponse.from(service.simulate(p.merchantId(),id,outcome,p.environment()));}
 public record CreateOrderRequest(@Positive long amount,@Pattern(regexp="INR") String currency,@NotBlank @Size(max=300) String description){}
 public record OrderResponse(UUID id,long amount,String currency,String description,PaymentStatus status,String environment,Instant createdAt){static OrderResponse from(PaymentOrder o){return new OrderResponse(o.getId(),o.getAmountMinor(),o.getCurrency(),o.getDescription(),o.getStatus(),o.getEnvironment(),o.getCreatedAt());}}
}

