package com.technext.pay.config;
import com.technext.pay.identity.AuthService; import org.springframework.http.*; import org.springframework.web.bind.MethodArgumentNotValidException; import org.springframework.web.bind.annotation.*; import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
@RestControllerAdvice public class ApiExceptionHandler {
 @ExceptionHandler(AuthService.ConflictException.class) ResponseEntity<?> conflict(RuntimeException e){return ResponseEntity.status(409).body(Map.of("error",e.getMessage()));}
 @ExceptionHandler(AuthService.UnauthorizedException.class) ResponseEntity<?> unauthorized(RuntimeException e){return ResponseEntity.status(401).body(Map.of("error",e.getMessage()));}
 @ExceptionHandler(IllegalStateException.class) ResponseEntity<?> stateConflict(IllegalStateException e){return ResponseEntity.status(409).body(Map.of("error",e.getMessage()));}
 @ExceptionHandler(DataIntegrityViolationException.class) ResponseEntity<?> dataConflict(DataIntegrityViolationException e){return ResponseEntity.status(409).body(Map.of("error","resource_conflict"));}
 @ExceptionHandler(MethodArgumentNotValidException.class) ResponseEntity<?> invalid(MethodArgumentNotValidException e){return ResponseEntity.badRequest().body(Map.of("error","invalid_request","message","Check the submitted fields."));}
 @ExceptionHandler(IllegalArgumentException.class) ResponseEntity<?> badRequest(IllegalArgumentException e){return ResponseEntity.badRequest().body(Map.of("error",e.getMessage()));}
}

