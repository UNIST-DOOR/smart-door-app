#import <React/RCTBridgeModule.h>
#import <React/RCTEventDispatcher.h>

@interface RCT_EXTERN_MODULE(MSALModule, NSObject)

RCT_EXTERN_METHOD(signInInteractive:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(acquireTokenSilent:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signOut:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return YES; }

@end


