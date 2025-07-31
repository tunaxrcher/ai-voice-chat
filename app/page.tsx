"use client"

import { useState, useRef, useEffect } from "react"
import { Mic, Square, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AIVoiceChat() {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [processingTime, setProcessingTime] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const processingStartTime = useRef<number>(0)
  const processingInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (processingInterval.current) {
        clearInterval(processingInterval.current)
      }
    }
  }, [])

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
      setStatusMessage("debug: กำลังฟังเสียง...")
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
      setStatusMessage("debug: กำลังส่งไปยัง AI และรอการประมวลผล...")
      startProcessingTimer()
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
      console.log("API route raw response:", responseText.substring(0, 200) + "...")

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
        console.log("Received audioUrl from n8n:", data.audioUrl)
        setStatusMessage("debug: ได้รับการตอบกลับจาก n8n แล้ว!")
        await playAIResponse(data.audioUrl)
      } else {
        console.log("No audioUrl in response or request failed:", data)
        const errorMessage = data.error || "ไม่ได้รับเสียงตอบกลับ"
        setStatusMessage(errorMessage)

        // Still play video without audio
        await playVideoOnly()
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

      // Fallback: play video only
      await playVideoOnly()

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

  const playVideoOnly = async () => {
    try {
      setIsVideoPlaying(true)
      if (videoRef.current) {
        // Reset video to beginning
        videoRef.current.currentTime = 0

        // Try to play video with proper error handling
        try {
          await videoRef.current.play()
          console.log("Video started playing successfully")
        } catch (playError) {
          console.log("Video autoplay blocked, will play silently")
          // Video autoplay is blocked, but we can still show the visual
          // The video element will show the first frame
        }
      }

      // Stop video after 3 seconds
      setTimeout(() => {
        setIsVideoPlaying(false)
        if (videoRef.current) {
          try {
            const pausePromise = videoRef.current.pause()
            if (pausePromise && typeof pausePromise.catch === "function") {
              pausePromise.catch(() => {
                // Ignore pause errors
              })
            }
          } catch (error) {
            // Ignore pause errors
          }
        }
      }, 3000)
    } catch (error) {
      console.error("Error playing video:", error)
      setIsVideoPlaying(false)
    }
  }

  const playAIResponse = async (audioUrl: string) => {
    try {
      console.log("Playing AI response with audio URL:", audioUrl)
      setIsVideoPlaying(true)

      // Prepare and play video
      if (videoRef.current) {
        videoRef.current.currentTime = 0

        try {
          await videoRef.current.play()
          console.log("Video started playing successfully")
        } catch (videoError) {
          console.log("Video autoplay blocked:", videoError)
          // Continue with audio even if video fails
        }
      }

      // Prepare and play audio from n8n response
      if (audioRef.current && audioUrl) {
        // Set up audio
        audioRef.current.src = audioUrl
        audioRef.current.currentTime = 0

        // Add event listeners
        audioRef.current.onerror = (e) => {
          console.error("Audio playback error:", e)
          console.error("Failed to load audio from:", audioUrl)
        }

        audioRef.current.onloadstart = () => {
          console.log("Started loading audio from:", audioUrl)
        }

        audioRef.current.oncanplay = () => {
          console.log("Audio can start playing")
        }

        audioRef.current.onended = () => {
          console.log("Audio playback ended")
          setIsVideoPlaying(false)
          if (videoRef.current) {
            try {
              const pausePromise = videoRef.current.pause()
              if (pausePromise && typeof pausePromise.catch === "function") {
                pausePromise.catch(() => {
                  // Ignore pause errors
                })
              }
            } catch (error) {
              // Ignore pause errors
            }
            // Reset video to the beginning after audio ends
            videoRef.current.currentTime = 0
          }
        }

        try {
          await audioRef.current.play()
          console.log("Audio started playing successfully")
        } catch (audioError) {
          console.log("Audio autoplay blocked:", audioError)
          // If audio fails, stop video after 3 seconds and reset position
          setTimeout(() => {
            setIsVideoPlaying(false)
            if (videoRef.current) {
              try {
                const pausePromise = videoRef.current.pause()
                if (pausePromise && typeof pausePromise.catch === "function") {
                  pausePromise.catch(() => {
                    // Ignore pause errors
                  })
                }
              } catch (error) {
                // Ignore pause errors
              }
              // Reset video to the beginning
              videoRef.current.currentTime = 0
            }
          }, 3000)
        }
      } else {
        console.log("No audio URL provided")
        // If no audio URL, stop video after 3 seconds and reset position
        setTimeout(() => {
          setIsVideoPlaying(false)
          if (videoRef.current) {
            try {
              const pausePromise = videoRef.current.pause()
              if (pausePromise && typeof pausePromise.catch === "function") {
                pausePromise.catch(() => {
                  // Ignore pause errors
                })
              }
            } catch (error) {
              // Ignore pause errors
            }
            // Reset video to the beginning
            videoRef.current.currentTime = 0
          }
        }, 3000)
      }
    } catch (error) {
      console.error("Error playing AI response:", error)
      setIsVideoPlaying(false)
    }
  }

  // Handle user interaction to enable media playback
  const handleUserInteraction = async () => {
    if (isRecording) {
      stopRecording()
    } else {
      // Enable media playback on first interaction
      try {
        if (videoRef.current) {
          // Try to play and immediately pause to enable future playback
          const playPromise = videoRef.current.play()
          if (playPromise !== undefined) {
            await playPromise
            videoRef.current.pause()
            videoRef.current.currentTime = 0
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
            className="w-full h-full object-cover"
            muted
            playsInline
            loop={isVideoPlaying}
            preload="metadata"
          >
            <source src="https://unityx-test.sgp1.digitaloceanspaces.com/kK-buE2QzxtHUHcfnZfKn5PqtCmQ0ORrvSv1mW4MDZw.mov" type="video/mp4" />
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
                  <span>debug: กำลังฟังเสียง...</span>
                </div>
              )}
              {isProcessing && (
                <div className="flex flex-col items-center space-y-1 bg-blue-500/95 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg backdrop-blur-sm">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>debug: กำลังประมวลผล...</span>
                  </div>
                  {processingTime > 0 && <div className="text-xs opacity-80">{formatTime(processingTime)}</div>}
                </div>
              )}
            </div>
          )}

          {/* Microphone Button - Overlaid at bottom of video */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20">
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
