#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <Vision/Vision.h>

static NSString *Recognize(CGImageRef image) {
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.recognitionLanguages = @[@"en-US", @"zh-Hant"];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) return @"";
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
        VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
        if (candidate.string) [lines addObject:candidate.string];
    }
    return [lines componentsJoinedByString:@"\n"];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "Missing path\n"); return 1; }
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        NSURL *url = [NSURL fileURLWithPath:path];
        NSMutableArray<NSString *> *parts = [NSMutableArray array];
        if ([[[path pathExtension] lowercaseString] isEqualToString:@"pdf"]) {
            PDFDocument *document = [[PDFDocument alloc] initWithURL:url];
            if (!document) { fprintf(stderr, "Invalid PDF\n"); return 1; }
            for (NSInteger index = 0; index < document.pageCount; index++) {
                PDFPage *page = [document pageAtIndex:index];
                NSString *embedded = [page.string stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                if (embedded.length > 20) { [parts addObject:embedded]; continue; }
                NSImage *bitmap = [page thumbnailOfSize:NSMakeSize(1800, 2400) forBox:kPDFDisplayBoxMediaBox];
                CGImageRef image = [bitmap CGImageForProposedRect:NULL context:nil hints:nil];
                if (image) [parts addObject:Recognize(image)];
            }
        } else {
            NSImage *bitmap = [[NSImage alloc] initWithContentsOfURL:url];
            CGImageRef image = [bitmap CGImageForProposedRect:NULL context:nil hints:nil];
            if (!image) { fprintf(stderr, "Invalid image\n"); return 1; }
            [parts addObject:Recognize(image)];
        }
        NSString *output = [parts componentsJoinedByString:@"\n\n"];
        fputs([output UTF8String], stdout);
        return 0;
    }
}
