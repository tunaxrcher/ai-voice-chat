"use client"

import { useState, useRef, useEffect } from "react"
import { Mic, Square, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

type VideoState = "default" | "thinking" | "saying"

const VIDEO_SOURCES = {
  default: "/ai_default.mp4",
  thinking: "/thinking.mp4", 
  saying: "/ai_saying.mp4"
}

export default function AIVoiceChat() {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [processingTime, setProcessingTime] = useState(0)
  const [currentVideoState, setCurrentVideoState] = useState<VideoState>("default")
  const [videoOpacity, setVideoOpacity] = useState(1)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const processingStartTime = useRef<number>(0)
  const processingInterval = useRef<NodeJS.Timeout | null>(null)
  const audioEndedTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (processingInterval.current) {
        clearInterval(processingInterval.current)
      }
      if (audioEndedTimeoutRef.current) {
        clearTimeout(audioEndedTimeoutRef.current)
      }
      // Clean up audio event listeners
      if (audioRef.current) {
        audioRef.current.onerror = null
        audioRef.current.onloadstart = null
        audioRef.current.oncanplay = null
        audioRef.current.onended = null
      }
      // Clean up video event listeners
      if (videoRef.current) {
        videoRef.current.onended = null
      }
      // Reset states
      setIsAudioPlaying(false)
    }
  }, [])

  // Initialize default video on component mount
  useEffect(() => {
    const initializeDefaultVideo = async () => {
      if (videoRef.current) {
        console.log("Initializing default video..")
        
        // Set default video source
        videoRef.current.src = VIDEO_SOURCES.default
        videoRef.current.currentTime = 0
        videoRef.current.loop = true // Loop the default video
        videoRef.current.load()
        
        // Try to play the default video
        try {
          await videoRef.current.play()
          console.log("Default video started playing successfully")
          setIsVideoPlaying(true)
        } catch (error) {
          console.log("Default video autoplay blocked, waiting for user interaction:", error)
          // Video autoplay is blocked, will play after user interaction
        }
      }
    }
    
    // Small delay to ensure component is fully mounted
    setTimeout(initializeDefaultVideo, 100)
  }, [])

  // Function to switch video with fade effect
  const switchVideo = async (newState: VideoState, force = false) => {
    console.log(`🎬 switchVideo called: ${currentVideoState} → ${newState} (force: ${force})`)
    
    if (currentVideoState === newState && !force) {
      console.log(`⚠️ Already on ${newState}, skipping switch`)
      return
    }

    console.log(`🎬 Starting video switch from ${currentVideoState} to ${newState}`)

    // Fade out
    setVideoOpacity(0)
    console.log(`🎬 Fade out started`)
    
    // Wait for fade out to complete
    await new Promise(resolve => setTimeout(resolve, 300))
    console.log(`🎬 Fade out completed`)
    
    // Change video source
    setCurrentVideoState(newState)
    console.log(`🎬 State changed to: ${newState}`)
    
    if (videoRef.current) {
      console.log(`🎬 Setting video src to: ${VIDEO_SOURCES[newState]}`)
      videoRef.current.src = VIDEO_SOURCES[newState]
      videoRef.current.currentTime = 0
      
      // Configure video loop based on state
      if (newState === "saying" || newState === "default" || newState === "thinking") {
        videoRef.current.loop = true
        console.log(`🎬 Loop enabled for ${newState}`)
      } else {
        videoRef.current.loop = false
        console.log(`🎬 Loop disabled for ${newState}`)
      }
      
      videoRef.current.load()
      console.log(`🎬 Video loaded`)
      
      // Auto-play the video after switching
      try {
        await videoRef.current.play()
        console.log(`✅ ${newState} video started playing successfully`)
        setIsVideoPlaying(true)
      } catch (error) {
        console.log(`⚠️ ${newState} video autoplay blocked:`, error)
        // Video autoplay might be blocked, but that's okay
      }
    } else {
      console.log(`❌ videoRef.current is null!`)
    }
    
    // Fade in
    console.log(`🎬 Starting fade in`)
    setTimeout(() => {
      setVideoOpacity(1)
      console.log(`✅ Fade in completed for ${newState}`)
    }, 50)
  }

  const startProcessingTimer = () => {
    processingStartTime.current = Date.now()
    setProcessingTime(0)

    processingInterval.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - processingStartTime.current) / 1000)
      setProcessingTime(elapsed)
    }, 1000)
  }

  const stopProcessingTimer = () => {
    if (processingInterval.current) {
      clearInterval(processingInterval.current)
      processingInterval.current = null
    }
  }

  const startRecording = async () => {
    try {
      setStatusMessage("")

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      })

      streamRef.current = stream
      audioChunksRef.current = []

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      })

      mediaRecorderRef.current = mediaRecorder

      // Handle data available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        console.log("Recording stopped, audio blob size:", audioBlob.size)

        // Send audio to webhook
        await sendAudioToWebhook(audioBlob)

        // Cleanup
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }
      }

      // Start recording
      mediaRecorder.start()
      setIsRecording(true)
      setStatusMessage("debug: กำลังฟังเสียง..")
    } catch (error) {
      console.error("Error starting recording:", error)
      setStatusMessage(`ไม่สามารถเข้าถึงไมโครโฟนได้: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setIsProcessing(true)
      setStatusMessage("debug: กำลังส่งไปยัง AI และรอการประมวลผล..")
      startProcessingTimer()
      
      // Switch to thinking video during processing
      console.log("🤔 Switching to thinking video (processing started)")
      switchVideo("thinking")
    }
  }

  const sendAudioToWebhook = async (audioBlob: Blob) => {
    try {
      console.log("Sending audio to API route, size:", audioBlob.size)

      // Create FormData
      const formData = new FormData()
      formData.append("audio", audioBlob, "audio.webm")

      // Send to our API route with longer timeout
      const response = await fetch("/api/webhook", {
        method: "POST",
        body: formData,
      })

      console.log("API route response status:", response.status)

      // Get response text first to handle both JSON and non-JSON responses
      const responseText = await response.text()
      console.log("API route raw response:", responseText.substring(0, 200) + "..")

      let data
      try {
        data = JSON.parse(responseText)
        console.log("API route parsed response data:", data)
      } catch (jsonError) {
        console.error("Failed to parse API response as JSON:", jsonError)
        console.error("Response was:", responseText)
        throw new Error(`Server returned invalid response: ${responseText.substring(0, 100)}`)
      }

      stopProcessingTimer()

      if (data.success && data.audioUrl) {
        console.log("✅ Received audioUrl from n8n:", data.audioUrl)
        console.log("🤔 Thinking completed - switching to AI saying")
        setStatusMessage("debug: ได้รับการตอบกลับจาก n8n แล้ว!")
        await playAIResponse(data.audioUrl)
      } else {
        console.log("❌ No audioUrl in response or request failed:", data)
        console.log("🤔 Thinking completed with error - switching to default")
        const errorMessage = data.error || "ไม่ได้รับเสียงตอบกลับ"
        setStatusMessage(errorMessage)

        // Switch back to default video for error case
        await switchVideo("default", true)
      }

      // Clear status message after 3 seconds
      setTimeout(() => {
        setStatusMessage("")
        setProcessingTime(0)
      }, 3000)
    } catch (error) {
      console.error("Error sending audio to webhook:", error)
      stopProcessingTimer()

      let errorMessage = "เกิดข้อผิดพลาด"
      if (error instanceof Error) {
        if (error.message.includes("timeout") || error.message.includes("timed out")) {
          errorMessage = "การประมวลผลใช้เวลานานเกินไป กรุณาลองใหม่"
        } else if (error.message.includes("Failed to fetch")) {
          errorMessage = "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้"
        } else if (error.message.includes("invalid response")) {
          errorMessage = "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่ถูกต้อง"
        } else {
          errorMessage = `เกิดข้อผิดพลาด: ${error.message.substring(0, 50)}`
        }
      }

      setStatusMessage(errorMessage)

      // Switch back to default video for error case
      console.log("🤔 Thinking interrupted by error - switching to default")
      await switchVideo("default", true)

      // Clear error message after 5 seconds
      setTimeout(() => {
        setStatusMessage("")
        setProcessingTime(0)
      }, 5000)
    } finally {
      setIsProcessing(false)
      stopProcessingTimer()
    }
  }



  const playAIResponse = async (audioUrl: string) => {
    try {
      console.log("🗣️ Playing AI response with audio URL:", audioUrl)
      
      // Switch to AI saying video
      console.log("🤔➡️🗣️ Switching from thinking to AI saying")
      await switchVideo("saying")
      setIsVideoPlaying(true)

      // Set up video event listeners for continuous loop during audio
      if (videoRef.current) {
        // Clear any existing video event listeners
        videoRef.current.onended = null
        
        // Add video ended listener to restart video if audio is still playing
        videoRef.current.onended = () => {
          console.log("🎬 AI saying video ended")
          console.log(`🎵 Audio still playing: ${isAudioPlaying}`)
          if (isAudioPlaying && videoRef.current) {
            console.log("🔄 Restarting AI saying video (audio still playing)")
            videoRef.current.currentTime = 0
            videoRef.current.play().catch((error) => {
              console.log("❌ Error restarting video:", error)
            })
          } else {
            console.log("🎬 Video ended, audio finished - no restart needed")
          }
        }

        try {
          await videoRef.current.play()
          console.log("AI saying video started playing successfully")
        } catch (videoError) {
          console.log("Video autoplay blocked:", videoError)
          // Continue with audio even if video fails
        }
      }

      // Prepare and play audio from n8n response
      if (audioRef.current && audioUrl) {
        // Clear any existing timeout
        if (audioEndedTimeoutRef.current) {
          clearTimeout(audioEndedTimeoutRef.current)
          audioEndedTimeoutRef.current = null
        }

        // Clear any existing event listeners first
        audioRef.current.onerror = null
        audioRef.current.onloadstart = null
        audioRef.current.oncanplay = null
        audioRef.current.onended = null

        // Set up audio
        audioRef.current.src = audioUrl
        audioRef.current.currentTime = 0

        // Add event listeners
        audioRef.current.onerror = (e) => {
          console.error("Audio playback error:", e)
          console.error("Failed to load audio from:", audioUrl)
          // Mark audio as not playing and switch back to default on error
          setIsAudioPlaying(false)
          setIsVideoPlaying(false)
          // Clean up video event listener
          if (videoRef.current) {
            videoRef.current.onended = null
          }
          switchVideo("default", true)
        }

        audioRef.current.onloadstart = () => {
          console.log("Started loading audio from:", audioUrl)
        }

        audioRef.current.oncanplay = () => {
          console.log("Audio can start playing")
        }

        audioRef.current.onended = () => {
          console.log("🎵 Audio playback ended - switching back to default video")
          console.log(`🎵 Current video state before switch: ${currentVideoState}`)
          console.log("🎵 Setting isAudioPlaying to false")
          
          // Mark audio as not playing anymore
          setIsAudioPlaying(false)
          setIsVideoPlaying(false)
          
          // Stop current video and disable loop immediately
          if (videoRef.current) {
            try {
              console.log(`🎬 Video element src before pause: ${videoRef.current.src}`)
              console.log(`🎬 Video element paused status: ${videoRef.current.paused}`)
              videoRef.current.onended = null // Remove video event listener
              videoRef.current.loop = false // Stop looping immediately
              videoRef.current.pause()
              console.log("🎬 AI saying video paused and loop disabled")
            } catch (error) {
              console.log("❌ Error pausing video:", error)
            }
          } else {
            console.log("❌ videoRef.current is null in onended!")
          }
          
          // Small delay before switching to ensure video is properly stopped
          setTimeout(() => {
            console.log("🔄 Switching to default video..")
            console.log(`🔄 Video state before switchVideo call: ${currentVideoState}`)
            switchVideo("default", true) // Force switch to default
          }, 100)
        }

        try {
          await audioRef.current.play()
          console.log("🎵 Audio started playing successfully")
          console.log("🎵 Setting isAudioPlaying to true")
          setIsAudioPlaying(true) // Mark audio as playing
        } catch (audioError) {
          console.log("Audio autoplay blocked:", audioError)
          // If audio fails, switch back to default after 3 seconds
          setIsAudioPlaying(false)
          if (videoRef.current) {
            videoRef.current.onended = null
          }
          audioEndedTimeoutRef.current = setTimeout(() => {
            setIsVideoPlaying(false)
            switchVideo("default", true)
          }, 3000)
        }
      } else {
        console.log("No audio URL provided")
        // If no audio URL, switch back to default after 3 seconds
        setIsAudioPlaying(false)
        if (videoRef.current) {
          videoRef.current.onended = null
        }
        audioEndedTimeoutRef.current = setTimeout(() => {
          setIsVideoPlaying(false)
          switchVideo("default", true)
        }, 3000)
      }
    } catch (error) {
      console.error("Error playing AI response:", error)
      setIsAudioPlaying(false)
      setIsVideoPlaying(false)
      if (videoRef.current) {
        videoRef.current.onended = null
      }
      switchVideo("default", true)
    }
  }

  // Handle user interaction to enable media playback
  const handleUserInteraction = async () => {
    if (isRecording) {
      stopRecording()
    } else {
      // Enable media playback and ensure default video is playing
      try {
        if (videoRef.current) {
          // If video is paused, try to play the default video
          if (videoRef.current.paused) {
            console.log("Starting default video playback..")
            videoRef.current.src = VIDEO_SOURCES.default
            videoRef.current.currentTime = 0
            videoRef.current.loop = true
            videoRef.current.load()
            
            const playPromise = videoRef.current.play()
            if (playPromise !== undefined) {
              await playPromise
              console.log("Default video started playing after user interaction")
              setIsVideoPlaying(true)
            }
          }
        }

        if (audioRef.current) {
          // Prepare audio context
          audioRef.current.load()
        }
      } catch (error) {
        console.log("Media preparation failed, but continuing:", error)
      }

      // Start recording
      await startRecording()
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleRefresh = () => {
    // Reset all states to initial values
    setIsRecording(false)
    setIsProcessing(false)
    setStatusMessage("")
    setIsVideoPlaying(false)
    setProcessingTime(0)
    setCurrentVideoState("default")
    setVideoOpacity(1)
    setIsAudioPlaying(false)

    // Stop any ongoing recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
    }

    // Stop any media streams
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Stop processing timer
    stopProcessingTimer()

    // Clear any timeouts
    if (audioEndedTimeoutRef.current) {
      clearTimeout(audioEndedTimeoutRef.current)
      audioEndedTimeoutRef.current = null
    }

    // Reset video to default
    if (videoRef.current) {
      videoRef.current.onended = null
      videoRef.current.src = VIDEO_SOURCES.default
      videoRef.current.currentTime = 0
      videoRef.current.loop = true
      videoRef.current.load()
      
      // Try to play default video
      videoRef.current.play().catch((error) => {
        console.log("Video autoplay blocked after refresh:", error)
      })
    }

    // Reset audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.src = ""
      audioRef.current.onerror = null
      audioRef.current.onloadstart = null
      audioRef.current.oncanplay = null
      audioRef.current.onended = null
    }

    console.log("🔄 App refreshed - all states reset")
  }

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-white via-gray-50 to-gray-100 flex flex-col relative overflow-hidden">
      {/* Background Effects - Adjusted for mobile */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent"></div>
      <div className="absolute top-1/3 left-1/4 w-24 h-24 bg-blue-500/5 rounded-full blur-xl animate-pulse"></div>
      <div className="absolute bottom-1/3 right-1/4 w-20 h-20 bg-gray-500/5 rounded-full blur-xl animate-pulse delay-1000"></div>

      {/* Header - Keep spacing but no text */}
      <div className="w-full px-4 pt-8 pb-4 z-10 safe-area-top"></div>

      {/* Video Container - Optimized for 16:9 AI person on mobile */}
      <div className="flex-1 flex items-center justify-center w-full relative z-10">
        <div className="relative w-full max-w-sm mx-auto aspect-[9/16] rounded-3xl overflow-hidden">
          <video
            ref={videoRef}
            className="w-full h-full object-cover transition-opacity duration-300"
            style={{ opacity: videoOpacity }}
            muted
            autoPlay
            playsInline
            loop={currentVideoState === "saying" || currentVideoState === "default" || currentVideoState === "thinking"}
            preload="metadata"
            src={VIDEO_SOURCES[currentVideoState]}
          >
            Your browser does not support the video tag.
          </video>

          {/* Video Overlay for better contrast */}
          <div className="absolute inset-0"></div>

          {/* Status Indicator - Positioned for mobile */}
          {(isRecording || isProcessing) && (
            <div className="absolute top-4 left-4 right-4 flex justify-center z-20">
              {isRecording && (
                <div className="flex items-center space-x-2 bg-red-500/95 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  <span>debug: กำลังฟังเสียง..</span>
                </div>
              )}
              {isProcessing && (
                <div className="flex flex-col items-center space-y-1 bg-blue-500/95 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg backdrop-blur-sm">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>debug: กำลังคิด..</span>
                  </div>
                  {processingTime > 0 && <div className="text-xs opacity-80">{formatTime(processingTime)}</div>}
                </div>
              )}
            </div>
          )}

          {/* Microphone Button - Overlaid at right upper-center of video */}
          <div className="absolute right-6 top-1/4 transform -translate-y-1/2 z-20">
            <Button
              onClick={handleUserInteraction}
              disabled={isProcessing}
              className={`w-16 h-16 rounded-full border-3 transition-all duration-300 shadow-2xl ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 border-red-300 shadow-red-500/50 animate-pulse scale-105"
                  : "bg-gray-800/80 hover:bg-gray-700/90 border-gray-600/60 backdrop-blur-sm hover:scale-105"
              } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isProcessing ? (
                <Loader2 className="w-7 h-7 text-white animate-spin" />
              ) : isRecording ? (
                <Square className="w-7 h-7 text-white" />
              ) : (
                <Mic className="w-7 h-7 text-white" />
              )}
            </Button>
          </div>

          {/* Refresh Button - Overlaid at bottom right of video */}
          <div className="absolute bottom-6 right-6 z-20">
            <Button
              onClick={handleRefresh}
              disabled={isProcessing}
              className="w-10 h-10 rounded-full bg-gray-600/80 hover:bg-gray-500/90 border border-gray-500/40 backdrop-blur-sm transition-all duration-300 hover:scale-105 shadow-lg"
            >
              <RefreshCw className="w-4 h-4 text-white" />
            </Button>
          </div>
        </div>
      </div>

      {/* Status Message Display - Mobile optimized */}
      {statusMessage && (
        <div className="w-full px-4 py-3 z-10">
          <div className="bg-gray-800/90 backdrop-blur-md rounded-xl p-3 border border-gray-700/30 shadow-lg max-w-sm mx-auto">
            <p className="text-white text-sm text-center leading-relaxed">{statusMessage}</p>
          </div>
        </div>
      )}

      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" crossOrigin="anonymous" preload="none" />
    </div>
  )
}
